use std::ffi::{CStr, CString, c_char, c_int, c_uint};
use std::ptr::null_mut;

use tauri::{
    AppHandle, Manager, Runtime,
    plugin::{Builder, TauriPlugin},
};

#[derive(Debug, thiserror::Error, serde::Serialize)]
pub enum Error {
    #[error("clipboard unavailable on OpenHarmony: {0}")]
    Unavailable(String),
    #[error("clipboard text is not valid UTF-8")]
    InvalidText,
    #[error("failed to create OHOS clipboard object")]
    CreateFailed,
}

pub type Result<T> = std::result::Result<T, Error>;

#[repr(C)]
struct PasteboardOpaque {
    _private: [u8; 0],
}

#[repr(C)]
struct UdmfDataOpaque {
    _private: [u8; 0],
}

#[repr(C)]
struct UdmfRecordOpaque {
    _private: [u8; 0],
}

#[repr(C)]
struct UdsPlainTextOpaque {
    _private: [u8; 0],
}

#[link(name = "pasteboard")]
unsafe extern "C" {
    fn OH_Pasteboard_Create() -> *mut PasteboardOpaque;
    fn OH_Pasteboard_Destroy(pasteboard: *mut PasteboardOpaque);
    fn OH_Pasteboard_SetData(pasteboard: *mut PasteboardOpaque, data: *mut UdmfDataOpaque) -> c_int;
    fn OH_Pasteboard_ClearData(pasteboard: *mut PasteboardOpaque) -> c_int;
    fn OH_Pasteboard_GetData(pasteboard: *mut PasteboardOpaque, status: *mut c_int) -> *mut UdmfDataOpaque;
}

#[link(name = "udmf")]
unsafe extern "C" {
    fn OH_UdmfData_Create() -> *mut UdmfDataOpaque;
    fn OH_UdmfData_Destroy(data: *mut UdmfDataOpaque);
    fn OH_UdmfData_AddRecord(data: *mut UdmfDataOpaque, record: *mut UdmfRecordOpaque) -> c_int;
    fn OH_UdmfData_GetRecords(data: *mut UdmfDataOpaque, count: *mut c_uint) -> *mut *mut UdmfRecordOpaque;
    fn OH_UdmfRecord_Create() -> *mut UdmfRecordOpaque;
    fn OH_UdmfRecord_Destroy(record: *mut UdmfRecordOpaque);
    fn OH_UdmfRecord_AddPlainText(record: *mut UdmfRecordOpaque, plain: *mut UdsPlainTextOpaque) -> c_int;
    fn OH_UdmfRecord_GetPlainText(record: *mut UdmfRecordOpaque, plain: *mut *mut UdsPlainTextOpaque) -> c_int;
    fn OH_UdsPlainText_Create() -> *mut UdsPlainTextOpaque;
    fn OH_UdsPlainText_Destroy(plain: *mut UdsPlainTextOpaque);
    fn OH_UdsPlainText_SetContent(plain: *mut UdsPlainTextOpaque, content: *const c_char) -> c_int;
    fn OH_UdsPlainText_GetContent(plain: *mut UdsPlainTextOpaque) -> *const c_char;
}

fn write_pasteboard_text(text: &str) -> Result<()> {
    let content = CString::new(text).map_err(|_| Error::InvalidText)?;
    let plain = unsafe { OH_UdsPlainText_Create() };
    if plain.is_null() {
        return Err(Error::CreateFailed);
    }
    let record = unsafe { OH_UdmfRecord_Create() };
    let data = unsafe { OH_UdmfData_Create() };
    let pasteboard = unsafe { OH_Pasteboard_Create() };

    let result = (|| {
        if record.is_null() || data.is_null() || pasteboard.is_null() {
            return Err(Error::CreateFailed);
        }
        if unsafe { OH_UdsPlainText_SetContent(plain, content.as_ptr()) } != 0 {
            return Err(Error::Unavailable("set plain text content".into()));
        }
        if unsafe { OH_UdmfRecord_AddPlainText(record, plain) } != 0 {
            return Err(Error::Unavailable("add plain text record".into()));
        }
        if unsafe { OH_UdmfData_AddRecord(data, record) } != 0 {
            return Err(Error::Unavailable("add record to data".into()));
        }
        if unsafe { OH_Pasteboard_SetData(pasteboard, data) } != 0 {
            return Err(Error::Unavailable("set pasteboard data".into()));
        }
        Ok(())
    })();

    if !pasteboard.is_null() {
        unsafe { OH_Pasteboard_Destroy(pasteboard) };
    }
    if !data.is_null() {
        unsafe { OH_UdmfData_Destroy(data) };
    }
    if !record.is_null() {
        unsafe { OH_UdmfRecord_Destroy(record) };
    }
    if !plain.is_null() {
        unsafe { OH_UdsPlainText_Destroy(plain) };
    }
    result
}

fn clear_pasteboard() -> Result<()> {
    let pasteboard = unsafe { OH_Pasteboard_Create() };
    if pasteboard.is_null() {
        return Err(Error::CreateFailed);
    }
    let rc = unsafe { OH_Pasteboard_ClearData(pasteboard) };
    unsafe { OH_Pasteboard_Destroy(pasteboard) };
    if rc != 0 {
        return Err(Error::Unavailable(format!("clear pasteboard: {rc}")));
    }
    Ok(())
}

fn read_pasteboard_text() -> Result<String> {
    let pasteboard = unsafe { OH_Pasteboard_Create() };
    if pasteboard.is_null() {
        return Err(Error::CreateFailed);
    }

    let mut status: c_int = 0;
    let data = unsafe { OH_Pasteboard_GetData(pasteboard, &mut status) };
    if data.is_null() {
        unsafe { OH_Pasteboard_Destroy(pasteboard) };
        return Err(Error::Unavailable(format!("get pasteboard data: {status}")));
    }

    let mut count: c_uint = 0;
    let records = unsafe { OH_UdmfData_GetRecords(data, &mut count) };
    let mut result: Option<String> = None;

    if !records.is_null() {
        for i in 0..count as usize {
            let record = unsafe { *records.add(i) };
            if record.is_null() {
                continue;
            }
            let mut plain: *mut UdsPlainTextOpaque = null_mut();
            if unsafe { OH_UdmfRecord_GetPlainText(record, &mut plain) } == 0 && !plain.is_null() {
                let content = unsafe { OH_UdsPlainText_GetContent(plain) };
                if !content.is_null() {
                    let text = unsafe { CStr::from_ptr(content) }.to_string_lossy().into_owned();
                    result = Some(text);
                    unsafe { OH_UdsPlainText_Destroy(plain) };
                    break;
                }
                unsafe { OH_UdsPlainText_Destroy(plain) };
            }
        }
    }

    unsafe { OH_UdmfData_Destroy(data) };
    unsafe { OH_Pasteboard_Destroy(pasteboard) };

    result.ok_or_else(|| Error::Unavailable("no plain text on clipboard".into()))
}

#[tauri::command]
fn write_text(text: String) -> Result<()> {
    write_pasteboard_text(&text)
}

#[tauri::command]
fn read_text() -> Result<String> {
    read_pasteboard_text()
}

#[tauri::command]
fn clear() -> Result<()> {
    clear_pasteboard()
}

pub struct Clipboard<R: Runtime> {
    #[allow(dead_code)]
    app: AppHandle<R>,
}

impl<R: Runtime> Clipboard<R> {
    pub fn write_text<S: AsRef<str>>(&self, _text: S) -> Result<()> {
        write_pasteboard_text(_text.as_ref())
    }

    pub fn read_text(&self) -> Result<String> {
        read_pasteboard_text()
    }

    pub fn clear(&self) -> Result<()> {
        clear_pasteboard()
    }
}

pub trait ClipboardExt<R: Runtime> {
    fn clipboard(&self) -> &Clipboard<R>;
}

impl<R: Runtime, T: Manager<R>> ClipboardExt<R> for T {
    fn clipboard(&self) -> &Clipboard<R> {
        self.state::<Clipboard<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("cv-tauri-plugin-clipboard-manager")
        .setup(|app, _api| {
            app.manage(Clipboard { app: app.clone() });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![write_text, read_text, clear])
        .build()
}
