//! Conversation rows: create, read, list, update, delete and search.

use rusqlite::{OptionalExtension, Row, params};

use super::{Store, StoreError, StoreResult, parse_json, to_json};
use crate::types::{
    ChatSettings, CompareColumn, Conversation, ConversationSummary, Millis, SearchHit, TitleSource,
};

const COLUMNS: &str = "id, title, title_source, pinned, temporary, current_leaf_id, compare_json, settings_json, created_at, updated_at";

fn row_to_conversation(row: &Row<'_>) -> rusqlite::Result<RawConversation> {
    Ok(RawConversation {
        id: row.get(0)?,
        title: row.get(1)?,
        title_source: row.get(2)?,
        pinned: row.get(3)?,
        temporary: row.get(4)?,
        current_leaf_id: row.get(5)?,
        compare_json: row.get(6)?,
        settings_json: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

struct RawConversation {
    id: String,
    title: String,
    title_source: String,
    pinned: bool,
    temporary: bool,
    current_leaf_id: Option<String>,
    compare_json: Option<String>,
    settings_json: String,
    created_at: Millis,
    updated_at: Millis,
}

impl RawConversation {
    fn into_conversation(self) -> StoreResult<Conversation> {
        let compare: Option<Vec<CompareColumn>> = parse_json(self.compare_json)?;
        let settings: ChatSettings = parse_json(Some(self.settings_json))?.unwrap_or_default();
        Ok(Conversation {
            id: self.id,
            title: self.title,
            title_source: TitleSource::parse(&self.title_source).unwrap_or(TitleSource::Auto),
            pinned: self.pinned,
            temporary: self.temporary,
            current_leaf_id: self.current_leaf_id,
            compare,
            settings,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

/// Escapes `%`, `_` and `\` for a LIKE pattern used with `ESCAPE '\'`.
fn like_pattern(query: &str) -> String {
    let mut out = String::with_capacity(query.len() + 2);
    out.push('%');
    for ch in query.chars() {
        if matches!(ch, '%' | '_' | '\\') {
            out.push('\\');
        }
        out.push(ch);
    }
    out.push('%');
    out
}

/// A ~120-character excerpt centered on the first case-insensitive match.
pub(crate) fn snippet(text: &str, query: &str) -> String {
    let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let lower = flat.to_lowercase();
    let needle = query.to_lowercase();
    let chars: Vec<char> = flat.chars().collect();
    let Some(byte_pos) = lower.find(&needle) else {
        return chars.iter().take(120).collect();
    };
    // Map the byte offset in the lowercased string to a char index (close enough for
    // scripts where lowercasing keeps lengths; clamped either way).
    let char_pos = lower[..byte_pos].chars().count().min(chars.len());
    let start = char_pos.saturating_sub(40);
    let end = (char_pos + needle.chars().count() + 80).min(chars.len());
    let mut out = String::new();
    if start > 0 {
        out.push('…');
    }
    out.extend(&chars[start..end]);
    if end < chars.len() {
        out.push('…');
    }
    out
}

impl Store {
    pub fn insert_conversation(&self, c: &Conversation) -> StoreResult<()> {
        let conn = self.conn()?;
        conn.execute(
            &format!("INSERT INTO conversations ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"),
            params![
                c.id,
                c.title,
                c.title_source.as_str(),
                c.pinned,
                c.temporary,
                c.current_leaf_id,
                c.compare.as_ref().map(to_json).transpose()?,
                to_json(&c.settings)?,
                c.created_at,
                c.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn get_conversation(&self, id: &str) -> StoreResult<Option<Conversation>> {
        let conn = self.conn()?;
        let raw = conn
            .query_row(
                &format!("SELECT {COLUMNS} FROM conversations WHERE id = ?1"),
                [id],
                row_to_conversation,
            )
            .optional()?;
        raw.map(RawConversation::into_conversation).transpose()
    }

    /// Writes every mutable field of a conversation.
    pub fn update_conversation(&self, c: &Conversation) -> StoreResult<()> {
        let conn = self.conn()?;
        let changed = conn.execute(
            "UPDATE conversations SET title = ?2, title_source = ?3, pinned = ?4, temporary = ?5,
                 current_leaf_id = ?6, compare_json = ?7, settings_json = ?8, updated_at = ?9
             WHERE id = ?1",
            params![
                c.id,
                c.title,
                c.title_source.as_str(),
                c.pinned,
                c.temporary,
                c.current_leaf_id,
                c.compare.as_ref().map(to_json).transpose()?,
                to_json(&c.settings)?,
                c.updated_at,
            ],
        )?;
        if changed == 0 {
            return Err(StoreError::Corrupt(format!(
                "conversation {} missing",
                c.id
            )));
        }
        Ok(())
    }

    /// History list: non-temporary chats, pinned first, newest first.
    pub fn list_conversations(&self) -> StoreResult<Vec<ConversationSummary>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, title, pinned, created_at, updated_at FROM conversations
             WHERE temporary = 0 ORDER BY pinned DESC, updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ConversationSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                pinned: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn delete_conversation(&self, id: &str) -> StoreResult<bool> {
        let conn = self.conn()?;
        Ok(conn.execute("DELETE FROM conversations WHERE id = ?1", [id])? > 0)
    }

    /// Removes temporary chats left from a previous session.
    pub fn delete_temporary_conversations(&self) -> StoreResult<usize> {
        let conn = self.conn()?;
        Ok(conn.execute("DELETE FROM conversations WHERE temporary = 1", [])?)
    }

    /// Chats whose title or message content contains `query` (case-insensitive).
    pub fn search_conversations(&self, query: &str, limit: u32) -> StoreResult<Vec<SearchHit>> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let pattern = like_pattern(query);
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT c.id, c.title, c.updated_at,
                    (SELECT m.content FROM messages m
                      WHERE m.conversation_id = c.id AND m.content LIKE ?1 ESCAPE '\\'
                      ORDER BY m.created_at LIMIT 1) AS hit
             FROM conversations c
             WHERE c.temporary = 0
               AND (c.title LIKE ?1 ESCAPE '\\'
                    OR EXISTS (SELECT 1 FROM messages m
                               WHERE m.conversation_id = c.id AND m.content LIKE ?1 ESCAPE '\\'))
             ORDER BY c.updated_at DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![pattern, limit], |row| {
            let title: String = row.get(1)?;
            let hit: Option<String> = row.get(3)?;
            Ok((
                row.get::<_, String>(0)?,
                title,
                row.get::<_, Millis>(2)?,
                hit,
            ))
        })?;
        let mut hits = Vec::new();
        for row in rows {
            let (conversation_id, title, updated_at, hit) = row?;
            let snippet = match hit {
                Some(content) => snippet(&content, query),
                None => snippet(&title, query),
            };
            hits.push(SearchHit {
                conversation_id,
                title,
                snippet,
                updated_at,
            });
        }
        Ok(hits)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Message, MessageStatus, Role};

    pub(crate) fn conversation(id: &str, updated_at: Millis) -> Conversation {
        Conversation {
            id: id.into(),
            title: format!("Chat {id}"),
            title_source: TitleSource::Auto,
            pinned: false,
            temporary: false,
            current_leaf_id: None,
            compare: None,
            settings: ChatSettings::default(),
            created_at: updated_at,
            updated_at,
        }
    }

    fn message(id: &str, conversation_id: &str, content: &str) -> Message {
        Message {
            id: id.into(),
            conversation_id: conversation_id.into(),
            parent_id: None,
            role: Role::User,
            content: content.into(),
            model_key: None,
            status: MessageStatus::Complete,
            error: None,
            tokens_in: None,
            tokens_out: None,
            cost_usd: None,
            elapsed_ms: None,
            created_at: 1,
            attachments: vec![],
        }
    }

    #[test]
    fn insert_get_update_round_trip() {
        let store = Store::open_in_memory().unwrap();
        let mut c = conversation("a", 10);
        c.compare = Some(vec![CompareColumn {
            model_key: "mixroute:gpt-4.1".into(),
            leaf_id: None,
        }]);
        c.settings.temperature = Some(0.5);
        store.insert_conversation(&c).unwrap();
        assert_eq!(store.get_conversation("a").unwrap(), Some(c.clone()));

        c.title = "Renamed".into();
        c.title_source = TitleSource::User;
        c.pinned = true;
        c.compare = None;
        store.update_conversation(&c).unwrap();
        assert_eq!(store.get_conversation("a").unwrap(), Some(c));
        assert_eq!(store.get_conversation("missing").unwrap(), None);
    }

    #[test]
    fn list_orders_pinned_then_recent_and_hides_temporary() {
        let store = Store::open_in_memory().unwrap();
        store.insert_conversation(&conversation("old", 1)).unwrap();
        store.insert_conversation(&conversation("new", 3)).unwrap();
        let mut pinned = conversation("pinned", 2);
        pinned.pinned = true;
        store.insert_conversation(&pinned).unwrap();
        let mut temp = conversation("temp", 9);
        temp.temporary = true;
        store.insert_conversation(&temp).unwrap();

        let ids: Vec<_> = store
            .list_conversations()
            .unwrap()
            .into_iter()
            .map(|c| c.id)
            .collect();
        assert_eq!(ids, ["pinned", "new", "old"]);

        assert_eq!(store.delete_temporary_conversations().unwrap(), 1);
        assert_eq!(store.get_conversation("temp").unwrap(), None);
    }

    #[test]
    fn delete_cascades_to_messages() {
        let store = Store::open_in_memory().unwrap();
        store.insert_conversation(&conversation("a", 1)).unwrap();
        store.insert_message(&message("m1", "a", "hi")).unwrap();
        assert!(store.delete_conversation("a").unwrap());
        assert_eq!(store.get_message("m1").unwrap(), None);
        assert!(!store.delete_conversation("a").unwrap());
    }

    #[test]
    fn search_matches_title_and_content_with_snippets() {
        let store = Store::open_in_memory().unwrap();
        let mut a = conversation("a", 1);
        a.title = "Rust lifetimes".into();
        store.insert_conversation(&a).unwrap();
        store.insert_conversation(&conversation("b", 2)).unwrap();
        store
            .insert_message(&message(
                "m1",
                "b",
                "Here is a long preamble before the interesting part about Borrow checking in Rust.",
            ))
            .unwrap();

        let hits = store.search_conversations("rust", 10).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].conversation_id, "b");
        assert!(hits[0].snippet.contains("Rust"));
        assert_eq!(hits[1].conversation_id, "a");

        let hits = store.search_conversations("borrow", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert!(store.search_conversations("   ", 10).unwrap().is_empty());
    }

    #[test]
    fn search_treats_wildcards_literally() {
        let store = Store::open_in_memory().unwrap();
        store.insert_conversation(&conversation("a", 1)).unwrap();
        store
            .insert_message(&message("m1", "a", "100% done"))
            .unwrap();
        store.insert_conversation(&conversation("b", 2)).unwrap();
        store
            .insert_message(&message("m2", "b", "100 done"))
            .unwrap();
        let hits = store.search_conversations("100%", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].conversation_id, "a");
    }

    #[test]
    fn snippet_centers_on_match() {
        let text = format!("{} needle {}", "a ".repeat(100), "b ".repeat(100));
        let s = snippet(&text, "NEEDLE");
        assert!(s.starts_with('…') && s.ends_with('…'));
        assert!(s.contains("needle"));
    }
}
