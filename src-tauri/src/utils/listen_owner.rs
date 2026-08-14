/// Returns whether `pid` currently owns a TCP or UDP listener on `port`.
pub fn process_listens_on_port(pid: u32, port: u16) -> bool {
    if pid == 0 || port == 0 {
        return false;
    }
    #[cfg(windows)]
    {
        windows_pid_listens_on_port(pid, port)
    }
    #[cfg(not(windows))]
    {
        let _ = (pid, port);
        false
    }
}

#[cfg(windows)]
fn windows_pid_listens_on_port(pid: u32, port: u16) -> bool {
    use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_INET6};

    tcp_owner_matches(pid, port, AF_INET as u32)
        || tcp_owner_matches(pid, port, AF_INET6 as u32)
        || udp_owner_matches(pid, port, AF_INET as u32)
        || udp_owner_matches(pid, port, AF_INET6 as u32)
}

#[cfg(windows)]
fn tcp_owner_matches(pid: u32, port: u16, family: u32) -> bool {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCP6ROW_OWNER_PID, MIB_TCPROW_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER,
    };
    use windows_sys::Win32::Networking::WinSock::AF_INET6;

    let Some(buffer) = query_ip_helper_table(family, |size, out| unsafe {
        GetExtendedTcpTable(out, size, 0, family, TCP_TABLE_OWNER_PID_LISTENER, 0)
    }) else {
        return false;
    };
    if family == AF_INET6 as u32 {
        return for_each_owner_row::<MIB_TCP6ROW_OWNER_PID>(&buffer, |row| {
            row.dwOwningPid == pid && port_from_win_dword(row.dwLocalPort) == port
        });
    }
    for_each_owner_row::<MIB_TCPROW_OWNER_PID>(&buffer, |row| {
        row.dwOwningPid == pid && port_from_win_dword(row.dwLocalPort) == port
    })
}

#[cfg(windows)]
fn udp_owner_matches(pid: u32, port: u16, family: u32) -> bool {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetExtendedUdpTable, MIB_UDP6ROW_OWNER_PID, MIB_UDPROW_OWNER_PID, UDP_TABLE_OWNER_PID,
    };
    use windows_sys::Win32::Networking::WinSock::AF_INET6;

    let Some(buffer) = query_ip_helper_table(family, |size, out| unsafe {
        GetExtendedUdpTable(out, size, 0, family, UDP_TABLE_OWNER_PID, 0)
    }) else {
        return false;
    };
    if family == AF_INET6 as u32 {
        return for_each_owner_row::<MIB_UDP6ROW_OWNER_PID>(&buffer, |row| {
            row.dwOwningPid == pid && port_from_win_dword(row.dwLocalPort) == port
        });
    }
    for_each_owner_row::<MIB_UDPROW_OWNER_PID>(&buffer, |row| {
        row.dwOwningPid == pid && port_from_win_dword(row.dwLocalPort) == port
    })
}

#[cfg(windows)]
fn query_ip_helper_table(
    _family: u32,
    mut query: impl FnMut(*mut u32, *mut core::ffi::c_void) -> u32,
) -> Option<Vec<u8>> {
    use windows_sys::Win32::Foundation::ERROR_INSUFFICIENT_BUFFER;

    let mut size = 0u32;
    let first = query(&raw mut size, std::ptr::null_mut());
    if first != ERROR_INSUFFICIENT_BUFFER || size < 4 {
        return None;
    }
    let mut buffer = vec![0u8; size as usize];
    let status = query(&raw mut size, buffer.as_mut_ptr().cast());
    if status != 0 {
        return None;
    }
    buffer.truncate(size as usize);
    Some(buffer)
}

#[cfg(windows)]
fn for_each_owner_row<T>(buffer: &[u8], mut matches: impl FnMut(&T) -> bool) -> bool {
    if buffer.len() < 4 {
        return false;
    }
    let count = u32::from_le_bytes([buffer[0], buffer[1], buffer[2], buffer[3]]) as usize;
    let header = std::mem::size_of::<u32>();
    let row_size = std::mem::size_of::<T>();
    if row_size == 0 || count == 0 {
        return false;
    }
    for index in 0..count {
        let offset = header + index * row_size;
        if offset + row_size > buffer.len() {
            return false;
        }
        // SAFETY: `buffer` came from GetExtendedTcpTable/GetExtendedUdpTable and is large enough
        // for `count` rows of `T` after the DWORD header.
        let row = unsafe { &*(buffer.as_ptr().add(offset).cast::<T>()) };
        if matches(row) {
            return true;
        }
    }
    false
}

#[cfg(windows)]
const fn port_from_win_dword(value: u32) -> u16 {
    u16::from_be(value as u16)
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    #[test]
    fn port_from_win_dword_uses_network_byte_order() {
        assert_eq!(super::port_from_win_dword(0xD204), 1234);
    }
}
