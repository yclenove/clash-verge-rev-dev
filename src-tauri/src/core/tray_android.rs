use anyhow::Result;
use once_cell::sync::Lazy;
use std::sync::Arc;

pub struct Tray;

static TRAY: Lazy<Arc<Tray>> = Lazy::new(|| Arc::new(Tray));

impl Tray {
    pub fn global() -> Arc<Tray> {
        TRAY.clone()
    }

    pub async fn init(&self) -> Result<()> {
        Ok(())
    }

    pub async fn update_menu(&self) -> Result<()> {
        Ok(())
    }

    pub async fn update_menu_and_icon(&self) {}

    pub async fn update_icon(&self, _verge: &crate::config::IVerge) -> Result<()> {
        Ok(())
    }

    pub async fn update_tooltip(&self) -> Result<()> {
        Ok(())
    }

    pub async fn update_click_behavior(&self) -> Result<()> {
        Ok(())
    }

    pub async fn update_part(&self) -> Result<()> {
        Ok(())
    }

    pub fn update_speed_task(&self, _enable_tray_speed: bool) {}
}
