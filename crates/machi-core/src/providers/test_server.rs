//! Minimal HTTP/1.1 server for adapter tests: replays recorded responses in order and
//! records each request. Every response closes its connection, so each request arrives
//! on a fresh socket. Tests never call live APIs (§13.2).

use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

#[derive(Debug, Clone)]
pub struct RecordedRequest {
    pub method: String,
    pub path: String,
    pub authorization: Option<String>,
    pub body: String,
}

#[derive(Debug, Clone)]
pub struct Reply {
    status: u16,
    content_type: &'static str,
    body: String,
    headers: Vec<(String, String)>,
    /// When set, SSE events are written one by one with this pause between them.
    event_delay: Option<Duration>,
}

impl Reply {
    pub fn sse(body: &str) -> Self {
        Self {
            status: 200,
            content_type: "text/event-stream",
            body: body.to_string(),
            headers: vec![],
            event_delay: None,
        }
    }

    pub fn slow_sse(body: &str, delay: Duration) -> Self {
        Self {
            event_delay: Some(delay),
            ..Self::sse(body)
        }
    }

    pub fn json(body: &str) -> Self {
        Self {
            status: 200,
            content_type: "application/json",
            body: body.to_string(),
            headers: vec![],
            event_delay: None,
        }
    }

    pub fn status(status: u16, body: &str) -> Self {
        Self {
            status,
            content_type: "application/json",
            body: body.to_string(),
            headers: vec![],
            event_delay: None,
        }
    }

    pub fn with_header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }
}

pub struct TestServer {
    port: u16,
    requests: Arc<Mutex<Vec<RecordedRequest>>>,
}

impl TestServer {
    pub async fn start(replies: Vec<Reply>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test server");
        let port = listener.local_addr().expect("local addr").port();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let recorded = requests.clone();
        tokio::spawn(async move {
            for reply in replies {
                let Ok((socket, _)) = listener.accept().await else {
                    return;
                };
                serve(socket, reply, &recorded).await;
            }
        });
        Self { port, requests }
    }

    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}/v1", self.port)
    }

    pub fn requests(&self) -> Vec<RecordedRequest> {
        self.requests.lock().expect("requests lock").clone()
    }
}

async fn serve(mut socket: TcpStream, reply: Reply, recorded: &Arc<Mutex<Vec<RecordedRequest>>>) {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let header_end = loop {
        let Ok(n) = socket.read(&mut chunk).await else {
            return;
        };
        if n == 0 {
            return;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos + 4;
        }
    };
    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.lines();
    let request_line = lines.next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    let mut content_length = 0usize;
    let mut authorization = None;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            match name.trim().to_ascii_lowercase().as_str() {
                "content-length" => content_length = value.trim().parse().unwrap_or(0),
                "authorization" => authorization = Some(value.trim().to_string()),
                _ => {}
            }
        }
    }
    while buf.len() < header_end + content_length {
        let Ok(n) = socket.read(&mut chunk).await else {
            return;
        };
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let body = String::from_utf8_lossy(&buf[header_end..]).to_string();
    recorded
        .lock()
        .expect("requests lock")
        .push(RecordedRequest {
            method,
            path,
            authorization,
            body,
        });

    let mut head = format!(
        "HTTP/1.1 {} X\r\nContent-Type: {}\r\nConnection: close\r\n",
        reply.status, reply.content_type
    );
    for (name, value) in &reply.headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    if reply.event_delay.is_none() {
        head.push_str(&format!("Content-Length: {}\r\n", reply.body.len()));
    }
    head.push_str("\r\n");
    if socket.write_all(head.as_bytes()).await.is_err() {
        return;
    }
    match reply.event_delay {
        None => {
            let _ = socket.write_all(reply.body.as_bytes()).await;
        }
        Some(delay) => {
            for event in reply.body.split_inclusive("\n\n") {
                if socket.write_all(event.as_bytes()).await.is_err() {
                    return;
                }
                let _ = socket.flush().await;
                tokio::time::sleep(delay).await;
            }
        }
    }
    let _ = socket.shutdown().await;
}
