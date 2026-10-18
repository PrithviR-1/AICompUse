//! Mock platform adapter for tests: reports whichever OS it is constructed with.

use crate::{OsKind, PlatformFacts, PlatformInfo};

pub struct MockPlatform {
    os: OsKind,
}

impl MockPlatform {
    pub fn new(os: OsKind) -> Self {
        Self { os }
    }
}

impl PlatformFacts for MockPlatform {
    fn info(&self) -> PlatformInfo {
        let modifier_label = match self.os {
            OsKind::MacOs => "⌘",
            OsKind::Windows | OsKind::Other => "Ctrl",
        };
        PlatformInfo {
            os: self.os,
            modifier_label: modifier_label.to_string(),
            arch: std::env::consts::ARCH.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_uses_platform_specific_modifier() {
        assert_eq!(MockPlatform::new(OsKind::MacOs).info().modifier_label, "⌘");
        assert_eq!(MockPlatform::new(OsKind::Windows).info().modifier_label, "Ctrl");
    }
}
