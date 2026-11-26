//! Windows Hello (Face / Fingerprint / PIN) + DPAPI key sealing.
//!
//! Stores a DPAPI-protected copy of the user's master password in the local
//! app-data directory, gated behind `UserConsentVerifier` (Windows Hello / PIN).
//! Never touches Firestore or `meta/vault`. On non-Windows platforms, all
//! functions degrade gracefully as unavailable.

use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn key_file_path(app: &AppHandle, uid: &str) -> PathBuf {
    let dir = app
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let mut hasher = Sha256::new();
    hasher.update(uid.as_bytes());
    let digest = hasher.finalize();
    let hex: String = digest.iter().take(16).map(|b| format!("{b:02x}")).collect();
    dir.join(format!("hello_{hex}.bin"))
}

pub fn has_enrolled_key(app: &AppHandle, uid: &str) -> bool {
    if uid.trim().is_empty() {
        return false;
    }
    key_file_path(app, uid).is_file()
}

pub fn clear_enrolled_key(app: &AppHandle, uid: &str) -> Result<(), String> {
    if uid.trim().is_empty() {
        return Ok(());
    }
    let path = key_file_path(app, uid);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to remove Windows Hello key: {e}"))?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::ptr;
    use windows::core::HSTRING;
    use windows::Security::Credentials::UI::{
        UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
    };
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    fn entropy_bytes(uid: &str) -> Vec<u8> {
        let mut out = b"space.scync.desktop.hello.v1:".to_vec();
        out.extend_from_slice(uid.as_bytes());
        out
    }

    fn dpapi_protect(plaintext: &[u8], uid: &str) -> Result<Vec<u8>, String> {
        let mut entropy = entropy_bytes(uid);
        let in_blob = CRYPT_INTEGER_BLOB {
            cbData: plaintext.len() as u32,
            pbData: plaintext.as_ptr() as *mut u8,
        };
        let mut entropy_blob = CRYPT_INTEGER_BLOB {
            cbData: entropy.len() as u32,
            pbData: entropy.as_mut_ptr(),
        };
        let mut out_blob = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };

        unsafe {
            CryptProtectData(
                &in_blob,
                None,
                Some(&mut entropy_blob),
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out_blob,
            )
            .map_err(|e| format!("Windows DPAPI encryption failed: {e}"))?;

            let slice = std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize);
            let result = slice.to_vec();
            let _ = LocalFree(HLOCAL(out_blob.pbData as *mut _));
            Ok(result)
        }
    }

    fn dpapi_unprotect(ciphertext: &[u8], uid: &str) -> Result<Vec<u8>, String> {
        let mut entropy = entropy_bytes(uid);
        let in_blob = CRYPT_INTEGER_BLOB {
            cbData: ciphertext.len() as u32,
            pbData: ciphertext.as_ptr() as *mut u8,
        };
        let mut entropy_blob = CRYPT_INTEGER_BLOB {
            cbData: entropy.len() as u32,
            pbData: entropy.as_mut_ptr(),
        };
        let mut out_blob = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };

        unsafe {
            CryptUnprotectData(
                &in_blob,
                None,
                Some(&mut entropy_blob),
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out_blob,
            )
            .map_err(|e| format!("Windows DPAPI decryption failed: {e}"))?;

            let slice = std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize);
            let result = slice.to_vec();
            // Zeroize the OS-allocated plaintext buffer before freeing.
            ptr::write_bytes(out_blob.pbData, 0, out_blob.cbData as usize);
            let _ = LocalFree(HLOCAL(out_blob.pbData as *mut _));
            Ok(result)
        }
    }

    pub fn is_available() -> bool {
        let op = match UserConsentVerifier::CheckAvailabilityAsync() {
            Ok(op) => op,
            Err(_) => return false,
        };
        match op.get() {
            Ok(avail) => avail == UserConsentVerifierAvailability::Available,
            Err(_) => false,
        }
    }

    fn verify_user(message: &str) -> Result<(), String> {
        if !is_available() {
            return Err("Windows Hello is not set up on this device.".into());
        }
        let msg = HSTRING::from(message);
        let op = UserConsentVerifier::RequestVerificationAsync(&msg)
            .map_err(|e| format!("Could not start Windows Hello prompt: {e}"))?;
        let result = op
            .get()
            .map_err(|e| format!("Windows Hello verification failed: {e}"))?;

        match result {
            UserConsentVerificationResult::Verified => Ok(()),
            UserConsentVerificationResult::Canceled => Err("BIOMETRIC_CANCELLED".into()),
            UserConsentVerificationResult::DeviceBusy => {
                Err("Windows Hello device is busy. Try again.".into())
            }
            UserConsentVerificationResult::RetriesExhausted => {
                Err("Too many Windows Hello attempts. Use your master password.".into())
            }
            UserConsentVerificationResult::DeviceNotPresent
            | UserConsentVerificationResult::NotConfiguredForUser
            | UserConsentVerificationResult::DisabledByPolicy => {
                Err("Windows Hello / PIN is not configured on this account.".into())
            }
            _ => Err("Windows Hello verification was not completed.".into()),
        }
    }

    pub fn enroll(app: &AppHandle, uid: &str, password: &str) -> Result<(), String> {
        if uid.trim().is_empty() || password.is_empty() {
            return Err("User ID and master password are required.".into());
        }
        verify_user("Verify your identity to enable Windows Hello unlock for Scync")?;

        let sealed = dpapi_protect(password.as_bytes(), uid)?;
        let path = key_file_path(app, uid);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&path, sealed).map_err(|e| format!("Failed to store sealed key: {e}"))?;
        Ok(())
    }

    pub fn unlock(app: &AppHandle, uid: &str) -> Result<String, String> {
        if !has_enrolled_key(app, uid) {
            return Err("Windows Hello unlock is not enabled for this account.".into());
        }
        verify_user("Unlock your Scync vault")?;

        let path = key_file_path(app, uid);
        let sealed = fs::read(&path).map_err(|e| format!("Failed to read sealed key: {e}"))?;
        let mut plain = dpapi_unprotect(&sealed, uid)?;
        let password = String::from_utf8(plain.clone())
            .map_err(|_| "Stored Windows Hello key is corrupted.".to_string())?;
        for b in &mut plain {
            *b = 0;
        }
        Ok(password)
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::*;

    pub fn is_available() -> bool {
        false
    }

    pub fn enroll(_app: &AppHandle, _uid: &str, _password: &str) -> Result<(), String> {
        Err("Windows Hello is only available on Windows.".into())
    }

    pub fn unlock(_app: &AppHandle, _uid: &str) -> Result<String, String> {
        Err("Windows Hello is only available on Windows.".into())
    }
}

pub fn is_available() -> bool {
    platform::is_available()
}

pub fn enroll(app: &AppHandle, uid: &str, password: &str) -> Result<(), String> {
    platform::enroll(app, uid, password)
}

pub fn unlock(app: &AppHandle, uid: &str) -> Result<String, String> {
    platform::unlock(app, uid)
}
