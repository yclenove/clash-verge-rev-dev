use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime,
};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("notification unavailable on OpenHarmony first HAP build")]
    Unavailable,
}

pub type Result<T> = std::result::Result<T, Error>;

pub struct Notification<R: Runtime> {
    #[allow(dead_code)]
    app: AppHandle<R>,
}

impl<R: Runtime> Notification<R> {
    pub fn builder(&self) -> NotificationBuilder<R> {
        NotificationBuilder {
            app: self.app.clone(),
            title: None,
            body: None,
        }
    }
}

pub struct NotificationBuilder<R: Runtime> {
    #[allow(dead_code)]
    app: AppHandle<R>,
    title: Option<String>,
    body: Option<String>,
}

impl<R: Runtime> NotificationBuilder<R> {
    pub fn title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    pub fn body(mut self, body: impl Into<String>) -> Self {
        self.body = Some(body.into());
        self
    }

    pub fn show(self) -> Result<()> {
        let _ = (self.title, self.body);
        // First HAP: swallow notifications instead of failing callers.
        Ok(())
    }
}

pub trait NotificationExt<R: Runtime> {
    fn notification(&self) -> &Notification<R>;
}

impl<R: Runtime, T: Manager<R>> NotificationExt<R> for T {
    fn notification(&self) -> &Notification<R> {
        self.state::<Notification<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("notification")
        .setup(|app, _api| {
            app.manage(Notification {
                app: app.clone(),
            });
            Ok(())
        })
        .build()
}
