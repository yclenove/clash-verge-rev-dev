use anyhow::Result;
use once_cell::sync::Lazy;
use std::sync::Arc;

#[derive(Clone, Copy, Debug)]
pub enum SystemHotkey {
    CmdQ,
    CmdW,
}

pub struct Hotkey;

static HOTKEY: Lazy<Arc<Hotkey>> = Lazy::new(|| Arc::new(Hotkey));

impl Hotkey {
    pub fn global() -> Arc<Hotkey> {
        HOTKEY.clone()
    }

    pub async fn init(&self, _skip: bool) -> Result<()> {
        Ok(())
    }

    pub async fn update(&self, _new_hotkeys: Vec<smartstring::alias::String>) -> Result<()> {
        Ok(())
    }

    pub fn reset(&self) -> Result<()> {
        Ok(())
    }

    pub fn unregister_system_hotkey(&self, _hotkey: SystemHotkey) -> Result<()> {
        Ok(())
    }
}
