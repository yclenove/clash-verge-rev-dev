use std::{
    ffi::{CString, OsStr},
    io::{BufRead, BufReader, Read},
    os::fd::{AsRawFd, FromRawFd, IntoRawFd, OwnedFd, RawFd},
    path::{Path, PathBuf},
    thread,
};

use tauri::{
    async_runtime::{self, Receiver},
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime,
};

pub mod process;

pub use process::{Command, CommandChild, CommandEvent, ExitStatus, Output, TerminatedPayload};

mod ncp {
    use super::RawFd;
    use std::ffi::{c_char, c_void};
    use std::sync::OnceLock;

    pub const NCP_NO_ERROR: i32 = 0;
    pub const NCP_ISOLATION_MODE_NORMAL: i32 = 0;

    #[repr(C)]
    pub struct NativeChildProcessFd {
        pub fd_name: *mut c_char,
        pub fd: i32,
        pub next: *mut NativeChildProcessFd,
    }

    #[repr(C)]
    pub struct NativeChildProcessFdList {
        pub head: *mut NativeChildProcessFd,
    }

    #[repr(C)]
    pub struct NativeChildProcessOptions {
        pub isolation_mode: i32,
        pub reserved: i64,
    }

    #[repr(C)]
    pub struct NativeChildProcessArgs {
        pub entry_params: *mut c_char,
        pub fd_list: NativeChildProcessFdList,
    }

    type StartFn = unsafe extern "C" fn(
        *const c_char,
        NativeChildProcessArgs,
        NativeChildProcessOptions,
        *mut i32,
    ) -> i32;
    type KillFn = unsafe extern "C" fn(i32) -> i32;

    struct Api {
        start: StartFn,
        kill: KillFn,
    }

    static API: OnceLock<Result<Api, String>> = OnceLock::new();

    fn load() -> Result<&'static Api, String> {
        API.get_or_init(|| unsafe {
            let lib = libc::dlopen(c"libchild_process.so".as_ptr(), libc::RTLD_NOW);
            if lib.is_null() {
                let err = std::ffi::CStr::from_ptr(libc::dlerror());
                return Err(format!("dlopen libchild_process.so failed: {err:?}"));
            }
            let start = libc::dlsym(lib, c"OH_Ability_StartNativeChildProcess".as_ptr());
            let kill = libc::dlsym(lib, c"OH_Ability_KillChildProcess".as_ptr());
            if start.is_null() || kill.is_null() {
                return Err("dlsym Start/Kill NativeChildProcess failed".into());
            }
            Ok(Api {
                start: std::mem::transmute::<*mut c_void, StartFn>(start),
                kill: std::mem::transmute::<*mut c_void, KillFn>(kill),
            })
        })
        .as_ref()
        .map_err(|e| e.clone())
    }

    pub fn start(
        entry: &str,
        entry_params: &str,
        stdout_fd: Option<RawFd>,
        stderr_fd: Option<RawFd>,
    ) -> Result<i32, String> {
        let api = load()?;
        let entry_c = std::ffi::CString::new(entry).map_err(|e| e.to_string())?;
        let params_c = std::ffi::CString::new(entry_params).map_err(|e| e.to_string())?;

        let mut stdout_name = std::ffi::CString::new("stdout").ok();
        let mut stderr_name = std::ffi::CString::new("stderr").ok();
        let mut nodes: Vec<Box<NativeChildProcessFd>> = Vec::new();

        if let (Some(fd), Some(name)) = (stdout_fd, stdout_name.as_mut()) {
            nodes.push(Box::new(NativeChildProcessFd {
                fd_name: name.as_ptr() as *mut c_char,
                fd,
                next: std::ptr::null_mut(),
            }));
        }
        if let (Some(fd), Some(name)) = (stderr_fd, stderr_name.as_mut()) {
            nodes.push(Box::new(NativeChildProcessFd {
                fd_name: name.as_ptr() as *mut c_char,
                fd,
                next: std::ptr::null_mut(),
            }));
        }

        for i in 0..nodes.len().saturating_sub(1) {
            let next_ptr = nodes[i + 1].as_mut() as *mut NativeChildProcessFd;
            nodes[i].next = next_ptr;
        }
        let head = nodes
            .first_mut()
            .map(|n| n.as_mut() as *mut NativeChildProcessFd)
            .unwrap_or(std::ptr::null_mut());

        let args = NativeChildProcessArgs {
            entry_params: params_c.as_ptr() as *mut c_char,
            fd_list: NativeChildProcessFdList { head },
        };
        let options = NativeChildProcessOptions {
            isolation_mode: NCP_ISOLATION_MODE_NORMAL,
            reserved: 0,
        };
        let mut pid: i32 = -1;
        let rc = unsafe { (api.start)(entry_c.as_ptr(), args, options, &mut pid as *mut i32) };
        drop(stdout_name);
        drop(stderr_name);
        drop(nodes);
        drop(params_c);
        drop(entry_c);

        if rc != NCP_NO_ERROR {
            return Err(format!(
                "OH_Ability_StartNativeChildProcess failed: code={rc}"
            ));
        }
        if pid <= 0 {
            return Err(format!("native child pid invalid: {pid}"));
        }
        Ok(pid)
    }

    pub fn kill(pid: i32) -> Result<(), String> {
        let api = load()?;
        let rc = unsafe { (api.kill)(pid) };
        if rc != NCP_NO_ERROR {
            return Err(format!("OH_Ability_KillChildProcess({pid}) failed: {rc}"));
        }
        Ok(())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("shell unavailable on OpenHarmony: {0}")]
    Unavailable(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

pub struct Shell<R: Runtime> {
    #[allow(dead_code)]
    app: AppHandle<R>,
}

impl<R: Runtime> Shell<R> {
    pub fn command(&self, program: impl AsRef<OsStr>) -> Command {
        Command::new(program)
    }

    pub fn sidecar(&self, program: impl AsRef<Path>) -> Result<Command> {
        Command::new_sidecar(program)
    }
}

pub trait ShellExt<R: Runtime> {
    fn shell(&self) -> &Shell<R>;
}

impl<R: Runtime, T: Manager<R>> ShellExt<R> for T {
    fn shell(&self) -> &Shell<R> {
        self.state::<Shell<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("shell")
        .setup(|app, _api| {
            app.manage(Shell {
                app: app.clone(),
            });
            Ok(())
        })
        .build()
}

/// Matches Rust `dirs::APP_ID` (hyphen form used for sandbox files).
pub fn sidecar_bin_dir() -> PathBuf {
    PathBuf::from("/data/storage/el2/base/files/io.github.clash-verge-rev.clash-verge-rev/bin")
}

fn sidecar_bin_dir_haps_entry() -> PathBuf {
    PathBuf::from(
        "/data/storage/el2/base/haps/entry/files/io.github.clash-verge-rev.clash-verge-rev/bin",
    )
}

pub fn ensure_sidecar_executable(name: &str) -> Result<PathBuf> {
    let dest_dir = sidecar_bin_dir();
    let dest = dest_dir.join(name);
    if dest.is_file() {
        let len = dest.metadata()?.len();
        if len > 1_000_000 {
            ensure_executable(&dest)?;
            return Ok(dest);
        }
        let _ = std::fs::remove_file(&dest);
    }

    let haps = sidecar_bin_dir_haps_entry().join(name);
    if haps.is_file() {
        let len = haps.metadata()?.len();
        if len > 1_000_000 {
            ensure_executable(&haps)?;
            return Ok(haps);
        }
    }

    std::fs::create_dir_all(&dest_dir)?;

    let candidates = candidate_sidecar_sources(name);
    let mut last_err: Option<std::io::Error> = None;
    for src in candidates {
        if !src.is_file() {
            continue;
        }
        match std::fs::copy(&src, &dest) {
            Ok(_) => {
                ensure_executable(&dest)?;
                return Ok(dest);
            }
            Err(e) => last_err = Some(e),
        }
    }

    // NCP runner ignores ELF path for execution (ClashMain is linked); still need argv0.
    if name.starts_with("verge-mihomo") {
        let _ = std::fs::create_dir_all(&dest_dir);
        return Ok(dest);
    }

    Err(last_err.map(Error::from).unwrap_or_else(|| {
        Error::Unavailable(format!(
            "sidecar `{name}` not found; tried rawfile/libs under app bundle and files dir"
        ))
    }))
}

fn candidate_sidecar_sources(name: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    out.push(sidecar_bin_dir_haps_entry().join(name));
    out.push(PathBuf::from(format!(
        "/data/storage/el1/bundle/entry/resources/rawfile/sidecar/{name}"
    )));
    out.push(PathBuf::from(format!(
        "/data/storage/el1/bundle/entry/resources/rawfile/{name}"
    )));
    out.push(PathBuf::from(format!(
        "/data/storage/el1/bundle/libs/arm64/{name}"
    )));
    out.push(sidecar_bin_dir().join(format!("{name}.src")));
    // legacy hyphen path
    out.push(PathBuf::from(format!(
        "/data/storage/el2/base/files/io.github.clash-verge-rev.clash-verge-rev/bin/{name}"
    )));
    out
}

fn ensure_executable(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(path)?.permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(path, perms)?;
    Ok(())
}

fn build_entry_params(program: &OsStr, args: &[std::ffi::OsString]) -> Result<String> {
    let mut parts: Vec<String> = Vec::with_capacity(1 + args.len());
    let prog = program
        .to_str()
        .ok_or_else(|| Error::Unavailable("sidecar path is not utf-8".into()))?;
    parts.push(prog.to_owned());
    for a in args {
        let s = a
            .to_str()
            .ok_or_else(|| Error::Unavailable("sidecar arg is not utf-8".into()))?;
        if s.contains('\n') {
            return Err(Error::Unavailable("sidecar arg contains newline".into()));
        }
        parts.push(s.to_owned());
    }
    Ok(parts.join("\n"))
}

fn make_pipe() -> Result<(OwnedFd, OwnedFd)> {
    let mut fds = [0; 2];
    let rc = unsafe { libc::pipe(fds.as_mut_ptr()) };
    if rc != 0 {
        return Err(Error::Io(std::io::Error::last_os_error()));
    }
    unsafe { Ok((OwnedFd::from_raw_fd(fds[0]), OwnedFd::from_raw_fd(fds[1]))) }
}

/// NCP children are spawned by nativespawn, not fork — `waitpid` returns ECHILD
/// immediately and would falsely emit `Terminated` while ClashMain is still running.
/// Poll with `kill(pid, 0)` until the process is gone.
///
/// Exit codes are not available this way; after we have observed the process alive,
/// disappearance is treated as exit 0 so `-t` / `output()` validation does not fall
/// back to `use_default_config` and wipe the OHOS-enhanced runtime yaml.
fn wait_pid(pid: i32) -> Option<i32> {
    use std::time::Duration;
    let mut seen_alive = false;
    loop {
        let r = unsafe { libc::kill(pid, 0) };
        if r == 0 {
            seen_alive = true;
            thread::sleep(Duration::from_millis(200));
            continue;
        }
        let err = std::io::Error::last_os_error();
        match err.raw_os_error() {
            Some(libc::ESRCH) => {
                return if seen_alive { Some(0) } else { None };
            }
            // Process exists but signal is denied — still alive.
            Some(libc::EPERM) => {
                seen_alive = true;
                thread::sleep(Duration::from_millis(200));
                continue;
            }
            Some(libc::EINTR) => continue,
            _ => return if seen_alive { Some(0) } else { None },
        }
    }
}

pub fn kill_ncp_child(pid: u32) -> std::result::Result<(), String> {
    ncp::kill(pid as i32)
}

impl Command {
    pub(crate) fn new(program: impl AsRef<OsStr>) -> Self {
        Self {
            program: program.as_ref().to_os_string(),
            args: Vec::new(),
            current_dir: None,
            envs: Vec::new(),
        }
    }

    pub(crate) fn new_sidecar(program: impl AsRef<Path>) -> Result<Self> {
        let name = program
            .as_ref()
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("verge-mihomo");
        let path = ensure_sidecar_executable(name)?;
        Ok(Self::new(path.as_os_str()))
    }

    pub fn args<I, S>(mut self, args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        self.args
            .extend(args.into_iter().map(|s| s.as_ref().to_os_string()));
        self
    }

    pub fn env<K, V>(mut self, key: K, value: V) -> Self
    where
        K: AsRef<OsStr>,
        V: AsRef<OsStr>,
    {
        self.envs
            .push((key.as_ref().to_os_string(), value.as_ref().to_os_string()));
        self
    }

    pub fn current_dir<P: AsRef<Path>>(mut self, current_dir: P) -> Self {
        self.current_dir = Some(current_dir.as_ref().to_path_buf());
        self
    }

    pub fn spawn(self) -> Result<(Receiver<CommandEvent>, CommandChild)> {
        let entry_params = build_entry_params(&self.program, &self.args)?;
        let (stdout_r, stdout_w) = make_pipe()?;
        let (stderr_r, stderr_w) = make_pipe()?;

        let pid = ncp::start(
            "libmihomo_runner.so:Main",
            &entry_params,
            Some(stdout_w.as_raw_fd()),
            Some(stderr_w.as_raw_fd()),
        )
        .map_err(Error::Unavailable)?;

        drop(stdout_w);
        drop(stderr_w);

        let (tx, rx) = async_runtime::channel(8);

        {
            let tx = tx.clone();
            let reader = unsafe { std::fs::File::from_raw_fd(stdout_r.into_raw_fd()) };
            thread::spawn(move || {
                let reader = BufReader::new(reader);
                for line in reader.lines() {
                    match line {
                        Ok(l) => {
                            let _ = tx.blocking_send(CommandEvent::Stdout(l.into_bytes()));
                        }
                        Err(e) => {
                            let _ = tx.blocking_send(CommandEvent::Error(e.to_string()));
                            break;
                        }
                    }
                }
            });
        }
        {
            let tx = tx.clone();
            let reader = unsafe { std::fs::File::from_raw_fd(stderr_r.into_raw_fd()) };
            thread::spawn(move || {
                let reader = BufReader::new(reader);
                for line in reader.lines() {
                    match line {
                        Ok(l) => {
                            let _ = tx.blocking_send(CommandEvent::Stderr(l.into_bytes()));
                        }
                        Err(e) => {
                            let _ = tx.blocking_send(CommandEvent::Error(e.to_string()));
                            break;
                        }
                    }
                }
            });
        }

        thread::spawn(move || {
            let code = wait_pid(pid);
            let _ = tx.blocking_send(CommandEvent::Terminated(TerminatedPayload {
                code,
                signal: None,
            }));
        });

        Ok((
            rx,
            CommandChild {
                pid: pid as u32,
                child: None,
                use_ncp_kill: true,
            },
        ))
    }

    pub async fn output(self) -> Result<Output> {
        async_runtime::spawn_blocking(move || {
            let entry_params = build_entry_params(&self.program, &self.args)?;
            let (stdout_r, stdout_w) = make_pipe()?;
            let (stderr_r, stderr_w) = make_pipe()?;

            let pid = ncp::start(
                "libmihomo_runner.so:Main",
                &entry_params,
                Some(stdout_w.as_raw_fd()),
                Some(stderr_w.as_raw_fd()),
            )
            .map_err(Error::Unavailable)?;
            drop(stdout_w);
            drop(stderr_w);

            let mut stdout_file = unsafe { std::fs::File::from_raw_fd(stdout_r.into_raw_fd()) };
            let mut stderr_file = unsafe { std::fs::File::from_raw_fd(stderr_r.into_raw_fd()) };
            let mut stdout = Vec::new();
            let mut stderr = Vec::new();

            let code = wait_pid(pid);
            let _ = stdout_file.read_to_end(&mut stdout);
            let _ = stderr_file.read_to_end(&mut stderr);

            Ok(Output {
                status: ExitStatus { code },
                stdout,
                stderr,
            })
        })
        .await
        .map_err(|e| Error::Unavailable(format!("output join: {e}")))?
    }

    pub async fn status(self) -> Result<ExitStatus> {
        let out = self.output().await?;
        Ok(out.status)
    }
}
