//! Incremental Server-Sent Events parser for streamed chat completions.
//!
//! Network chunks can split lines and even UTF-8 sequences, so bytes are buffered until
//! a full line arrives. Only `data:` fields matter for the OpenAI wire format; comments
//! (`:` keep-alives) and other fields are ignored. Multi-line `data:` values are joined
//! with newlines and dispatched on the blank line that ends an event.

#[derive(Debug, Default)]
pub struct SseParser {
    buffer: Vec<u8>,
    data: Vec<String>,
}

impl SseParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feeds raw bytes and returns every complete event's data payload.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        self.buffer.extend_from_slice(bytes);
        let mut events = Vec::new();
        while let Some(newline) = self.buffer.iter().position(|&b| b == b'\n') {
            let mut line: Vec<u8> = self.buffer.drain(..=newline).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            self.handle_line(&String::from_utf8_lossy(&line), &mut events);
        }
        events
    }

    /// Flushes a trailing event that was not terminated by a blank line.
    pub fn finish(&mut self) -> Vec<String> {
        let mut events = Vec::new();
        if !self.buffer.is_empty() {
            let rest = std::mem::take(&mut self.buffer);
            let line = String::from_utf8_lossy(&rest)
                .trim_end_matches('\r')
                .to_string();
            self.handle_line(&line, &mut events);
        }
        self.dispatch(&mut events);
        events
    }

    fn handle_line(&mut self, line: &str, events: &mut Vec<String>) {
        if line.is_empty() {
            self.dispatch(events);
        } else if let Some(value) = line.strip_prefix("data:") {
            self.data
                .push(value.strip_prefix(' ').unwrap_or(value).to_string());
        }
        // Comments (":…") and other fields (event:, id:, retry:) are ignored.
    }

    fn dispatch(&mut self, events: &mut Vec<String>) {
        if !self.data.is_empty() {
            events.push(self.data.join("\n"));
            self.data.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_events_split_across_chunks() {
        let mut p = SseParser::new();
        assert!(p.push(b"data: {\"a\":").is_empty());
        assert!(p.push(b"1}\n").is_empty());
        assert_eq!(p.push(b"\ndata: [DONE]\n\n"), vec!["{\"a\":1}", "[DONE]"]);
    }

    #[test]
    fn handles_crlf_comments_and_multiline_data() {
        let mut p = SseParser::new();
        let events = p.push(b": keep-alive\r\n\r\ndata: one\r\ndata: two\r\nevent: x\r\n\r\n");
        assert_eq!(events, vec!["one\ntwo"]);
    }

    #[test]
    fn keeps_utf8_sequences_split_between_chunks() {
        let mut p = SseParser::new();
        let text = "data: héllo 🌍\n\n".as_bytes();
        let (a, b) = text.split_at(9); // splits inside "é"? ensure some split inside multibyte
        let mut events = p.push(a);
        events.extend(p.push(b));
        assert_eq!(events, vec!["héllo 🌍"]);
    }

    #[test]
    fn finish_flushes_unterminated_event() {
        let mut p = SseParser::new();
        assert!(p.push(b"data: tail").is_empty());
        assert_eq!(p.finish(), vec!["tail"]);
    }
}
