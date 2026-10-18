//! Message-tree helpers and conversion of a branch into provider messages.
//!
//! Context always follows the tree path from the root to the message being answered,
//! whichever models produced earlier replies, so switching models keeps context (§11.4).

use std::collections::HashMap;

use crate::models::ModelInfo;
use crate::providers::types::{ChatMessage, ChatRole, ContentPart};
use crate::types::{AttachmentKind, ChatSettings, Message, Role};

/// Messages of one conversation indexed for tree walks.
pub struct Tree<'a> {
    by_id: HashMap<&'a str, &'a Message>,
    messages: &'a [Message],
}

impl<'a> Tree<'a> {
    pub fn new(messages: &'a [Message]) -> Self {
        Self {
            by_id: messages.iter().map(|m| (m.id.as_str(), m)).collect(),
            messages,
        }
    }

    pub fn get(&self, id: &str) -> Option<&'a Message> {
        self.by_id.get(id).copied()
    }

    /// Root-to-`id` path (inclusive), oldest first. Stops safely on broken links.
    pub fn path_to(&self, id: &str) -> Vec<&'a Message> {
        let mut path = Vec::new();
        let mut cursor = self.get(id);
        while let Some(message) = cursor {
            if path.len() > self.messages.len() {
                break; // defensive: a cycle would be data corruption
            }
            path.push(message);
            cursor = message.parent_id.as_deref().and_then(|p| self.get(p));
        }
        path.reverse();
        path
    }

    pub fn children(&self, id: Option<&str>) -> Vec<&'a Message> {
        self.messages
            .iter()
            .filter(|m| m.parent_id.as_deref() == id)
            .collect()
    }

    /// Follows the newest child from `id` down to a leaf (used when switching branches).
    pub fn latest_leaf(&self, id: &str) -> String {
        let mut current = id.to_string();
        for _ in 0..=self.messages.len() {
            match self
                .children(Some(&current))
                .into_iter()
                .max_by_key(|m| m.created_at)
            {
                Some(child) => current = child.id.clone(),
                None => break,
            }
        }
        current
    }

    /// `id` and all of its descendants.
    pub fn subtree(&self, id: &str) -> Vec<String> {
        let mut out = vec![id.to_string()];
        let mut index = 0;
        while index < out.len() {
            let parent = out[index].clone();
            out.extend(
                self.children(Some(&parent))
                    .into_iter()
                    .map(|m| m.id.clone()),
            );
            index += 1;
        }
        out
    }
}

/// Converts a branch (ending with the user message being answered) into the provider
/// message list, applying the chat's system prompt and the model's capabilities.
pub fn build_messages(
    path: &[&Message],
    settings: &ChatSettings,
    model: Option<&ModelInfo>,
) -> Vec<ChatMessage> {
    let vision = model.is_some_and(|m| m.caps.vision);
    let mut out = Vec::with_capacity(path.len() + 1);
    if let Some(prompt) = settings
        .system_prompt
        .as_deref()
        .filter(|p| !p.trim().is_empty())
    {
        out.push(ChatMessage::text(ChatRole::System, prompt));
    }
    for message in path {
        match message.role {
            Role::Assistant => {
                // Failed or stopped-before-first-token replies carry no content.
                if !message.content.trim().is_empty() {
                    out.push(ChatMessage::text(
                        ChatRole::Assistant,
                        message.content.clone(),
                    ));
                }
            }
            Role::User => out.push(user_message(message, vision)),
        }
    }
    out
}

fn user_message(message: &Message, vision: bool) -> ChatMessage {
    let mut parts = Vec::new();
    if !message.content.is_empty() {
        parts.push(ContentPart::Text(message.content.clone()));
    }
    for attachment in &message.attachments {
        match attachment.kind {
            AttachmentKind::Text => parts.push(ContentPart::Text(format!(
                "Attached file `{}`:\n```\n{}\n```",
                attachment.name, attachment.data
            ))),
            AttachmentKind::Image if vision => {
                parts.push(ContentPart::ImageUrl(attachment.data.clone()))
            }
            // Earlier images stay in history as a note when the current model can't see them.
            AttachmentKind::Image => parts.push(ContentPart::Text(format!(
                "[Image attached: {}]",
                attachment.name
            ))),
        }
    }
    if parts.is_empty() {
        parts.push(ContentPart::Text(String::new()));
    }
    ChatMessage {
        role: ChatRole::User,
        content: parts,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Catalog;
    use crate::types::{Attachment, MessageStatus};

    fn m(id: &str, parent: Option<&str>, role: Role, at: i64, content: &str) -> Message {
        Message {
            id: id.into(),
            conversation_id: "c".into(),
            parent_id: parent.map(str::to_string),
            role,
            content: content.into(),
            model_key: None,
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

    fn sample() -> Vec<Message> {
        vec![
            m("u1", None, Role::User, 1, "hi"),
            m("a1", Some("u1"), Role::Assistant, 2, "hello"),
            m("a2", Some("u1"), Role::Assistant, 3, "hey there"),
            m("u2", Some("a2"), Role::User, 4, "more"),
            m("a3", Some("u2"), Role::Assistant, 5, ""),
        ]
    }

    #[test]
    fn path_children_leaf_and_subtree() {
        let messages = sample();
        let tree = Tree::new(&messages);
        let path: Vec<_> = tree.path_to("a3").iter().map(|m| m.id.as_str()).collect();
        assert_eq!(path, ["u1", "a2", "u2", "a3"]);
        assert_eq!(tree.children(Some("u1")).len(), 2);
        assert_eq!(tree.children(None).len(), 1);
        assert_eq!(tree.latest_leaf("u1"), "a3");
        assert_eq!(tree.latest_leaf("a1"), "a1");
        let mut sub = tree.subtree("a2");
        sub.sort();
        assert_eq!(sub, ["a2", "a3", "u2"]);
    }

    #[test]
    fn build_messages_adds_system_prompt_and_skips_empty_replies() {
        let messages = sample();
        let tree = Tree::new(&messages);
        let path = tree.path_to("a3");
        let settings = ChatSettings {
            system_prompt: Some("Be brief.".into()),
            ..Default::default()
        };
        let built = build_messages(&path[..3], &settings, None);
        let roles: Vec<_> = built.iter().map(|m| m.role).collect();
        assert_eq!(
            roles,
            [
                ChatRole::System,
                ChatRole::User,
                ChatRole::Assistant,
                ChatRole::User
            ]
        );
        let with_empty = build_messages(&path, &ChatSettings::default(), None);
        assert_eq!(with_empty.len(), 3, "empty assistant reply skipped");
    }

    #[test]
    fn images_are_sent_only_to_vision_models() {
        let mut message = m("u1", None, Role::User, 1, "what is this");
        message.attachments = vec![
            Attachment {
                id: "i".into(),
                kind: AttachmentKind::Image,
                name: "cat.png".into(),
                mime: "image/png".into(),
                size: 3,
                data: "data:image/png;base64,AAA".into(),
            },
            Attachment {
                id: "t".into(),
                kind: AttachmentKind::Text,
                name: "notes.txt".into(),
                mime: "text/plain".into(),
                size: 5,
                data: "hello".into(),
            },
        ];
        let catalog = Catalog::embedded().unwrap();
        let vision = catalog.lookup("mixroute:gpt-4.1").unwrap();
        let blind = catalog.lookup("mixroute:gpt-4.1-nano").unwrap();
        let path = [&message];

        let built = build_messages(&path, &ChatSettings::default(), Some(&vision));
        assert!(matches!(built[0].content[1], ContentPart::ImageUrl(_)));
        assert!(
            matches!(&built[0].content[2], ContentPart::Text(t) if t.contains("notes.txt") && t.contains("hello"))
        );

        let built = build_messages(&path, &ChatSettings::default(), Some(&blind));
        assert!(
            matches!(&built[0].content[1], ContentPart::Text(t) if t == "[Image attached: cat.png]")
        );
    }
}
