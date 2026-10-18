//! Message rows (a tree per conversation) and their attachments.

use std::collections::HashMap;

use rusqlite::{OptionalExtension, Row, Transaction, params};

use super::{Store, StoreError, StoreResult, parse_json, to_json};
use crate::error::ErrorInfo;
use crate::types::{Attachment, AttachmentKind, Message, MessageStatus, Millis, Role};

const COLUMNS: &str = "id, conversation_id, parent_id, role, content, model_key, status, error_json, tokens_in, tokens_out, cost_usd, elapsed_ms, created_at";

struct RawMessage {
    id: String,
    conversation_id: String,
    parent_id: Option<String>,
    role: String,
    content: String,
    model_key: Option<String>,
    status: String,
    error_json: Option<String>,
    tokens_in: Option<u32>,
    tokens_out: Option<u32>,
    cost_usd: Option<f64>,
    elapsed_ms: Option<u32>,
    created_at: Millis,
}

fn row_to_raw(row: &Row<'_>) -> rusqlite::Result<RawMessage> {
    Ok(RawMessage {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        parent_id: row.get(2)?,
        role: row.get(3)?,
        content: row.get(4)?,
        model_key: row.get(5)?,
        status: row.get(6)?,
        error_json: row.get(7)?,
        tokens_in: row.get(8)?,
        tokens_out: row.get(9)?,
        cost_usd: row.get(10)?,
        elapsed_ms: row.get(11)?,
        created_at: row.get(12)?,
    })
}

impl RawMessage {
    fn into_message(self, attachments: Vec<Attachment>) -> StoreResult<Message> {
        let role = Role::parse(&self.role)
            .ok_or_else(|| StoreError::Corrupt(format!("unknown role {}", self.role)))?;
        let status = MessageStatus::parse(&self.status)
            .ok_or_else(|| StoreError::Corrupt(format!("unknown status {}", self.status)))?;
        let error: Option<ErrorInfo> = parse_json(self.error_json)?;
        Ok(Message {
            id: self.id,
            conversation_id: self.conversation_id,
            parent_id: self.parent_id,
            role,
            content: self.content,
            model_key: self.model_key,
            status,
            error,
            tokens_in: self.tokens_in,
            tokens_out: self.tokens_out,
            cost_usd: self.cost_usd,
            elapsed_ms: self.elapsed_ms,
            created_at: self.created_at,
            attachments,
        })
    }
}

fn kind_str(kind: AttachmentKind) -> &'static str {
    match kind {
        AttachmentKind::Image => "image",
        AttachmentKind::Text => "text",
    }
}

fn parse_kind(value: &str) -> StoreResult<AttachmentKind> {
    match value {
        "image" => Ok(AttachmentKind::Image),
        "text" => Ok(AttachmentKind::Text),
        other => Err(StoreError::Corrupt(format!(
            "unknown attachment kind {other}"
        ))),
    }
}

fn insert_attachments(
    tx: &Transaction<'_>,
    message_id: &str,
    items: &[Attachment],
) -> StoreResult<()> {
    let mut stmt = tx.prepare(
        "INSERT INTO attachments (id, message_id, position, kind, name, mime, size, data)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )?;
    for (position, a) in items.iter().enumerate() {
        stmt.execute(params![
            a.id,
            message_id,
            position as i64,
            kind_str(a.kind),
            a.name,
            a.mime,
            a.size,
            a.data
        ])?;
    }
    Ok(())
}

/// Final state written when a generation ends.
#[derive(Debug, Clone, PartialEq)]
pub struct MessageCompletion {
    pub content: String,
    pub status: MessageStatus,
    pub error: Option<ErrorInfo>,
    pub tokens_in: Option<u32>,
    pub tokens_out: Option<u32>,
    pub cost_usd: Option<f64>,
    pub elapsed_ms: Option<u32>,
}

impl Store {
    pub fn insert_message(&self, m: &Message) -> StoreResult<()> {
        let mut conn = self.conn()?;
        let tx = conn.transaction()?;
        tx.execute(
            &format!("INSERT INTO messages ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)"),
            params![
                m.id,
                m.conversation_id,
                m.parent_id,
                m.role.as_str(),
                m.content,
                m.model_key,
                m.status.as_str(),
                m.error.as_ref().map(to_json).transpose()?,
                m.tokens_in,
                m.tokens_out,
                m.cost_usd,
                m.elapsed_ms,
                m.created_at,
            ],
        )?;
        insert_attachments(&tx, &m.id, &m.attachments)?;
        tx.commit()?;
        Ok(())
    }

    pub fn get_message(&self, id: &str) -> StoreResult<Option<Message>> {
        let conn = self.conn()?;
        let raw = conn
            .query_row(
                &format!("SELECT {COLUMNS} FROM messages WHERE id = ?1"),
                [id],
                row_to_raw,
            )
            .optional()?;
        let Some(raw) = raw else { return Ok(None) };
        let mut stmt = conn.prepare(
            "SELECT id, kind, name, mime, size, data FROM attachments WHERE message_id = ?1 ORDER BY position",
        )?;
        let attachments = stmt
            .query_map([id], |r| {
                Ok((
                    r.get(0)?,
                    r.get::<_, String>(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            })?
            .map(|row| {
                let (id, kind, name, mime, size, data) = row?;
                Ok(Attachment {
                    id,
                    kind: parse_kind(&kind)?,
                    name,
                    mime,
                    size,
                    data,
                })
            })
            .collect::<StoreResult<Vec<_>>>()?;
        raw.into_message(attachments).map(Some)
    }

    /// Every message of a conversation (all branches), oldest first.
    pub fn list_messages(&self, conversation_id: &str) -> StoreResult<Vec<Message>> {
        let conn = self.conn()?;
        let mut attachment_stmt = conn.prepare(
            "SELECT a.message_id, a.id, a.kind, a.name, a.mime, a.size, a.data
             FROM attachments a JOIN messages m ON m.id = a.message_id
             WHERE m.conversation_id = ?1 ORDER BY a.message_id, a.position",
        )?;
        let mut by_message: HashMap<String, Vec<Attachment>> = HashMap::new();
        let rows = attachment_stmt.query_map([conversation_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, u32>(5)?,
                r.get::<_, String>(6)?,
            ))
        })?;
        for row in rows {
            let (message_id, id, kind, name, mime, size, data) = row?;
            by_message.entry(message_id).or_default().push(Attachment {
                id,
                kind: parse_kind(&kind)?,
                name,
                mime,
                size,
                data,
            });
        }

        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS} FROM messages WHERE conversation_id = ?1 ORDER BY created_at, rowid"
        ))?;
        let raws = stmt
            .query_map([conversation_id], row_to_raw)?
            .collect::<Result<Vec<_>, _>>()?;
        raws.into_iter()
            .map(|raw| {
                let attachments = by_message.remove(&raw.id).unwrap_or_default();
                raw.into_message(attachments)
            })
            .collect()
    }

    /// Persists partial streamed content (called periodically while streaming).
    pub fn update_message_content(&self, id: &str, content: &str) -> StoreResult<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE messages SET content = ?2 WHERE id = ?1",
            params![id, content],
        )?;
        Ok(())
    }

    /// Writes the final state of a generation.
    pub fn complete_message(&self, id: &str, done: &MessageCompletion) -> StoreResult<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE messages SET content = ?2, status = ?3, error_json = ?4, tokens_in = ?5,
                 tokens_out = ?6, cost_usd = ?7, elapsed_ms = ?8
             WHERE id = ?1",
            params![
                id,
                done.content,
                done.status.as_str(),
                done.error.as_ref().map(to_json).transpose()?,
                done.tokens_in,
                done.tokens_out,
                done.cost_usd,
                done.elapsed_ms,
            ],
        )?;
        Ok(())
    }

    /// Deletes a message and its whole subtree (foreign-key cascade).
    pub fn delete_message(&self, id: &str) -> StoreResult<bool> {
        let conn = self.conn()?;
        Ok(conn.execute("DELETE FROM messages WHERE id = ?1", [id])? > 0)
    }

    /// Crash recovery: generations interrupted by quitting become "stopped".
    pub fn mark_streaming_as_stopped(&self) -> StoreResult<usize> {
        let conn = self.conn()?;
        Ok(conn.execute(
            "UPDATE messages SET status = 'stopped' WHERE status = 'streaming'",
            [],
        )?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorKind;
    use crate::types::{ChatSettings, Conversation, TitleSource};

    fn store_with_conversation() -> Store {
        let store = Store::open_in_memory().unwrap();
        store
            .insert_conversation(&Conversation {
                id: "c".into(),
                title: String::new(),
                title_source: TitleSource::Auto,
                pinned: false,
                temporary: false,
                current_leaf_id: None,
                compare: None,
                settings: ChatSettings::default(),
                created_at: 0,
                updated_at: 0,
            })
            .unwrap();
        store
    }

    fn msg(id: &str, parent: Option<&str>, role: Role, at: Millis) -> Message {
        Message {
            id: id.into(),
            conversation_id: "c".into(),
            parent_id: parent.map(str::to_string),
            role,
            content: format!("content {id}"),
            model_key: (role == Role::Assistant).then(|| "mixroute:gpt-4.1-nano".to_string()),
            status: MessageStatus::Complete,
            error: None,
            tokens_in: None,
            tokens_out: None,
            cost_usd: None,
            elapsed_ms: None,
            created_at: at,
            attachments: vec![],
        }
    }

    #[test]
    fn messages_round_trip_with_attachments_in_order() {
        let store = store_with_conversation();
        let mut m = msg("u1", None, Role::User, 1);
        m.attachments = vec![
            Attachment {
                id: "a1".into(),
                kind: AttachmentKind::Image,
                name: "cat.png".into(),
                mime: "image/png".into(),
                size: 3,
                data: "data:image/png;base64,AAA".into(),
            },
            Attachment {
                id: "a2".into(),
                kind: AttachmentKind::Text,
                name: "notes.md".into(),
                mime: "text/markdown".into(),
                size: 5,
                data: "hello".into(),
            },
        ];
        store.insert_message(&m).unwrap();
        assert_eq!(store.get_message("u1").unwrap(), Some(m.clone()));
        assert_eq!(store.list_messages("c").unwrap(), vec![m]);
    }

    #[test]
    fn completion_updates_status_usage_and_error() {
        let store = store_with_conversation();
        let mut a = msg("a1", None, Role::Assistant, 1);
        a.status = MessageStatus::Streaming;
        a.content.clear();
        store.insert_message(&a).unwrap();
        store.update_message_content("a1", "partial").unwrap();
        assert_eq!(store.get_message("a1").unwrap().unwrap().content, "partial");

        let error = ErrorInfo::new(ErrorKind::RateLimited, "slow down");
        store
            .complete_message(
                "a1",
                &MessageCompletion {
                    content: "partial answer".into(),
                    status: MessageStatus::Error,
                    error: Some(error.clone()),
                    tokens_in: Some(12),
                    tokens_out: Some(3),
                    cost_usd: Some(0.0001),
                    elapsed_ms: Some(900),
                },
            )
            .unwrap();
        let got = store.get_message("a1").unwrap().unwrap();
        assert_eq!(got.status, MessageStatus::Error);
        assert_eq!(got.error, Some(error));
        assert_eq!(got.tokens_in, Some(12));
        assert_eq!(got.elapsed_ms, Some(900));
    }

    #[test]
    fn deleting_a_message_removes_its_subtree_only() {
        let store = store_with_conversation();
        store
            .insert_message(&msg("u1", None, Role::User, 1))
            .unwrap();
        store
            .insert_message(&msg("a1", Some("u1"), Role::Assistant, 2))
            .unwrap();
        store
            .insert_message(&msg("a2", Some("u1"), Role::Assistant, 3))
            .unwrap();
        store
            .insert_message(&msg("u2", Some("a1"), Role::User, 4))
            .unwrap();
        assert!(store.delete_message("a1").unwrap());
        let ids: Vec<_> = store
            .list_messages("c")
            .unwrap()
            .into_iter()
            .map(|m| m.id)
            .collect();
        assert_eq!(ids, ["u1", "a2"]);
    }

    #[test]
    fn interrupted_streams_are_marked_stopped() {
        let store = store_with_conversation();
        let mut a = msg("a1", None, Role::Assistant, 1);
        a.status = MessageStatus::Streaming;
        store.insert_message(&a).unwrap();
        assert_eq!(store.mark_streaming_as_stopped().unwrap(), 1);
        assert_eq!(
            store.get_message("a1").unwrap().unwrap().status,
            MessageStatus::Stopped
        );
    }
}
