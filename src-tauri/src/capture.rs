// Aufnahme über WASAPI: Mikrofon oder der PC-Ton (Loopback), von Windows auf 16 kHz Mono umgerechnet. Läuft nur, solange eine
// Sitzung aus speech.rs es verlangt, und schreibt selbst nichts auf die Platte. Dazu die Umwandlung von Dateien über Windows.
use crate::speech::RATE;
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use windows::core::{HSTRING, PCWSTR};
use windows::Media::MediaProperties::{AudioEncodingQuality, MediaEncodingProfile};
use windows::Media::Transcoding::MediaTranscoder;
use windows::Storage::{CreationCollisionOption, StorageFile, StorageFolder};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Media::Audio::{
    eCapture, eConsole, eRender, EDataFlow, IAudioCaptureClient, IAudioClient, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_LOOPBACK, AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, DEVICE_STATE_ACTIVE, WAVEFORMATEX,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

type Audio = mpsc::Sender<(&'static str, Vec<i16>)>;

#[derive(Serialize)]
pub struct Device {
    id: String,
    name: String,
}

#[derive(Serialize)]
pub struct Devices {
    microphones: Vec<Device>,
    speakers: Vec<Device>,
}

unsafe fn enumerator() -> windows::core::Result<IMMDeviceEnumerator> {
    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
}

unsafe fn list(e: &IMMDeviceEnumerator, flow: EDataFlow) -> windows::core::Result<Vec<Device>> {
    let all = e.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE)?;
    let mut out = Vec::new();
    for i in 0..all.GetCount()? {
        let d = all.Item(i)?;
        let id = d.GetId()?;
        let id_text = id.to_string().unwrap_or_default();
        windows::Win32::System::Com::CoTaskMemFree(Some(id.0 as _));
        let name = d
            .OpenPropertyStore(STGM_READ)
            .and_then(|p| p.GetValue(&PKEY_Device_FriendlyName))
            .map(|v| v.to_string())
            .unwrap_or_else(|_| id_text.clone());
        out.push(Device { id: id_text, name });
    }
    Ok(out)
}

// Nur Namen, dabei wird nichts aufgenommen
#[tauri::command]
pub fn speech_devices() -> Result<Devices, String> {
    unsafe {
        let e = enumerator().map_err(|e| e.to_string())?;
        Ok(Devices { microphones: list(&e, eCapture).map_err(|e| e.to_string())?, speakers: list(&e, eRender).map_err(|e| e.to_string())? })
    }
}

fn readable(what: &str, e: windows::core::Error) -> String {
    let code = e.code().0 as u32;
    match code {
        0x8007_0005 => format!("{what}: Windows verweigert den Zugriff. Unter Einstellungen → Datenschutz → Mikrofon den Zugriff für Desktop-Apps erlauben."),
        0x8889_0004 | 0x8007_0490 => format!("{what}: Das Gerät ist nicht verfügbar oder wurde entfernt."),
        0x8889_000F | 0x8889_000A => format!("{what}: Ein anderes Programm belegt das Gerät gerade ausschließlich."),
        _ => format!("{what}: {e}"),
    }
}

unsafe fn device(e: &IMMDeviceEnumerator, id: Option<&str>, loopback: bool) -> windows::core::Result<IMMDevice> {
    match id {
        Some(id) if !id.is_empty() => e.GetDevice(PCWSTR(HSTRING::from(id).as_ptr())),
        _ => e.GetDefaultAudioEndpoint(if loopback { eRender } else { eCapture }, eConsole),
    }
}

// Öffnet das Gerät und nimmt in einem eigenen Thread auf. Fehler beim Öffnen kommen direkt zurück, nicht erst später
pub fn record(id: Option<String>, loopback: bool, source: &'static str, audio: Audio, stop: Arc<AtomicBool>) -> Result<JoinHandle<()>, String> {
    let what = if loopback { "PC-Ton" } else { "Mikrofon" };
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    let handle = std::thread::spawn(move || unsafe {
        let opened = (|| -> windows::core::Result<(IAudioClient, IAudioCaptureClient)> {
            let e = enumerator()?;
            let d = device(&e, id.as_deref(), loopback)?;
            let client: IAudioClient = d.Activate(CLSCTX_ALL, None)?;
            // Windows rechnet selbst um: 16 kHz, Mono, 16 Bit, egal was das Gerät liefert
            let format = WAVEFORMATEX { wFormatTag: 1, nChannels: 1, nSamplesPerSec: RATE as u32, nAvgBytesPerSec: (RATE * 2) as u32, nBlockAlign: 2, wBitsPerSample: 16, cbSize: 0 };
            let mut flags = AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
            if loopback {
                flags |= AUDCLNT_STREAMFLAGS_LOOPBACK;
            }
            client.Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 10_000_000, 0, &format, None)?;
            let capture: IAudioCaptureClient = client.GetService()?;
            client.Start()?;
            Ok((client, capture))
        })();
        let (client, capture) = match opened {
            Ok(x) => {
                let _ = ready_tx.send(Ok(()));
                x
            }
            Err(e) => {
                let _ = ready_tx.send(Err(readable(what, e)));
                return;
            }
        };
        let start = Instant::now();
        let mut sent: usize = 0;
        while !stop.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(40));
            let mut got: Vec<i16> = Vec::new();
            loop {
                let Ok(size) = capture.GetNextPacketSize() else { break };
                if size == 0 {
                    break;
                }
                let mut data = std::ptr::null_mut();
                let mut frames = 0u32;
                let mut flags = 0u32;
                if capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None).is_err() {
                    break;
                }
                if flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data.is_null() {
                    got.resize(got.len() + frames as usize, 0);
                } else {
                    got.extend_from_slice(std::slice::from_raw_parts(data as *const i16, frames as usize));
                }
                let _ = capture.ReleaseBuffer(frames);
            }
            sent += got.len();
            // Ist nichts zu hören, liefert der PC-Ton gar keine Daten: mit Stille auffüllen, sonst laufen die Spuren auseinander
            let expected = start.elapsed().as_millis() as usize * RATE / 1000;
            if expected > sent + RATE / 5 {
                let missing = expected - sent;
                got.resize(got.len() + missing, 0);
                sent += missing;
            }
            if !got.is_empty() && audio.send((source, got)).is_err() {
                break;
            }
        }
        let _ = client.Stop();
    });
    match ready_rx.recv() {
        Ok(Ok(())) => Ok(handle),
        Ok(Err(e)) => Err(e),
        Err(_) => Err(format!("{what}: Die Aufnahme ließ sich nicht starten")),
    }
}

// Test ohne Geräte: spielt eine WAV-Datei in vierfachem Tempo ein. Nur der Debug-Build ruft das auf
pub fn play_file(path: String, source: &'static str, audio: Audio, stop: Arc<AtomicBool>) -> JoinHandle<()> {
    std::thread::spawn(move || {
        let samples = std::fs::read(&path).map_err(|e| e.to_string()).and_then(|b| crate::speech::wav_samples(&b)).unwrap_or_default();
        for part in samples.chunks(RATE / 10) {
            if stop.load(Ordering::SeqCst) {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
            if audio.send((source, part.to_vec())).is_err() {
                break;
            }
        }
    })
}

pub enum Target {
    Wav16k,
    M4a,
}

// Datei umwandeln mit den Bordmitteln von Windows (MP3, M4A, WMA, WAV, auch Ton aus MP4)
pub fn transcode(from: &Path, to: &Path, target: Target) -> Result<(), String> {
    let result = run_transcode(from, to, target).map_err(|e| e.message().to_string());
    if result.is_err() {
        let _ = std::fs::remove_file(to);
    }
    result
}

fn run_transcode(from: &Path, to: &Path, target: Target) -> windows::core::Result<()> {
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    let input = StorageFile::GetFileFromPathAsync(&HSTRING::from(from.as_os_str()))?.join()?;
    let folder = StorageFolder::GetFolderFromPathAsync(&HSTRING::from(to.parent().unwrap().as_os_str()))?.join()?;
    let name = HSTRING::from(to.file_name().unwrap().to_os_string());
    let output = folder.CreateFileAsync(&name, CreationCollisionOption::ReplaceExisting)?.join()?;
    let profile = match target {
        Target::Wav16k => {
            let p = MediaEncodingProfile::CreateWav(AudioEncodingQuality::Low)?;
            let audio = p.Audio()?;
            audio.SetSampleRate(RATE as u32)?;
            audio.SetChannelCount(1)?;
            audio.SetBitsPerSample(16)?;
            audio.SetBitrate((RATE * 16) as u32)?;
            p
        }
        Target::M4a => MediaEncodingProfile::CreateM4a(AudioEncodingQuality::Low)?,
    };
    let coder = MediaTranscoder::new()?;
    let prepared = coder.PrepareFileTranscodeAsync(&input, &output, &profile)?.join()?;
    if !prepared.CanTranscode()? {
        return Err(windows::core::Error::new(windows::core::HRESULT(-1), "Windows kennt dieses Dateiformat nicht oder die Datei ist beschädigt"));
    }
    prepared.TranscodeAsync()?.join()?;
    Ok(())
}
