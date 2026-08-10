use serde::Serialize;
use std::{
    ffi::OsString,
    path::PathBuf,
    process::Child,
    sync::{Arc, Mutex},
};

/// Payload for the [`CommandEvent::Terminated`] command event.
#[derive(Debug, Clone, Serialize)]
pub struct TerminatedPayload {
    pub code: Option<i32>,
    pub signal: Option<i32>,
}

#[derive(Debug, Clone)]
#[non_exhaustive]
pub enum CommandEvent {
    Stderr(Vec<u8>),
    Stdout(Vec<u8>),
    Error(String),
    Terminated(TerminatedPayload),
}

#[derive(Debug)]
pub struct Command {
    pub(crate) program: OsString,
    pub(crate) args: Vec<OsString>,
    pub(crate) current_dir: Option<PathBuf>,
    pub(crate) envs: Vec<(OsString, OsString)>,
}

#[derive(Debug)]
pub struct CommandChild {
    pub(crate) pid: u32,
    pub(crate) child: Option<Arc<Mutex<Child>>>,
    pub(crate) use_ncp_kill: bool,
}

impl CommandChild {
    pub fn write(&mut self, _buf: &[u8]) -> crate::Result<()> {
        Err(crate::Error::Unavailable(
            "stdin write unavailable on OpenHarmony shell".into(),
        ))
    }

    pub fn kill(self) -> crate::Result<()> {
        if self.use_ncp_kill {
            return crate::kill_ncp_child(self.pid).map_err(crate::Error::Unavailable);
        }
        if let Some(child) = self.child {
            let mut guard = child.lock().map_err(|_| {
                crate::Error::Unavailable("sidecar child lock poisoned".into())
            })?;
            let _ = guard.kill();
            let _ = guard.wait();
            return Ok(());
        }
        Ok(())
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }
}

#[derive(Debug)]
pub struct ExitStatus {
    pub(crate) code: Option<i32>,
}

impl ExitStatus {
    pub fn code(&self) -> Option<i32> {
        self.code
    }

    pub fn success(&self) -> bool {
        self.code == Some(0)
    }
}

#[derive(Debug)]
pub struct Output {
    pub status: ExitStatus,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}
