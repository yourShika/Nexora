// Sprache in Text, nur lokal: whisper.cpp läuft als eigener Prozess auf 127.0.0.1 (Ordner whisper, Modell in <Daten>/sprache).
// Das Audio verlässt den PC nicht. Aufgenommen wird nur nach ausdrücklichem Start aus der Oberfläche; ohne „Audio behalten“ bleibt
// nichts auf der Platte, die Abschnitte gehen aus dem Speicher direkt an die Erkennung. Aufnahme selbst: capture.rs.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::fs;
use std::io::Write;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};

pub const RATE: usize = 16_000;
const FRAME: usize = RATE / 10; // 100 ms
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// Modelle aus https://huggingface.co/ggerganov/whisper.cpp; Größe und Prüfsumme von dort
pub struct Model {
    pub id: &'static str,
    file: &'static str,
    size: u64,
    sha256: &'static str,
    // Das große Modell schafft Live nur mit verkürztem Rechenfenster
    short_window: bool,
}
pub const MODELS: [Model; 2] = [
    Model { id: "small", file: "ggml-small-q5_1.bin", size: 190_085_487, sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb", short_window: false },
    Model { id: "turbo", file: "ggml-large-v3-turbo-q5_0.bin", size: 574_041_195, sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2", short_window: true },
];

fn model_of(id: &str) -> Result<&'static Model, String> {
    MODELS.iter().find(|m| m.id == id).ok_or_else(|| "Unbekanntes Sprachmodell".to_string())
}

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("sprache"))
}

// ---- Audio und Abschnitte: reine Logik, direkt testbar ----

pub fn wav_bytes(samples: &[i16]) -> Vec<u8> {
    let data = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // Mono
    out.extend_from_slice(&(RATE as u32).to_le_bytes());
    out.extend_from_slice(&((RATE * 2) as u32).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data.to_le_bytes());
    for s in samples {
        out.extend_from_slice(&s.to_le_bytes());
    }
    out
}

// 16 Bit Mono aus einer WAV-Datei; andere Formate wandelt vorher die Windows-Umwandlung
pub fn wav_samples(bytes: &[u8]) -> Result<Vec<i16>, String> {
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("Keine WAV-Datei".into());
    }
    let mut at = 12;
    while at + 8 <= bytes.len() {
        let size = u32::from_le_bytes(bytes[at + 4..at + 8].try_into().unwrap()) as usize;
        if &bytes[at..at + 4] == b"data" {
            let end = (at + 8 + size).min(bytes.len());
            return Ok(bytes[at + 8..end].chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect());
        }
        at += 8 + size + (size & 1);
    }
    Err("Die WAV-Datei enthält kein Audio".into())
}

fn frame_rms(samples: &[i16]) -> Vec<f32> {
    samples.chunks(FRAME).map(|f| (f.iter().map(|s| (*s as f64).powi(2)).sum::<f64>() / f.len() as f64).sqrt() as f32).collect()
}

const MIN_LOUD: f32 = 300.0;

// Spricht da jemand? Sonst erfindet Whisper in der Stille gern Sätze. Sprache ist laut genug und schwankt; ein gleichmäßiges
// Brummen schwankt nicht. Auch durchgehendes Reden ohne Pause muss hier durchkommen
pub fn has_speech(samples: &[i16]) -> bool {
    let frames = frame_rms(samples);
    if frames.is_empty() {
        return false;
    }
    let mut sorted = frames.clone();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let floor = sorted[sorted.len() / 5];
    let peak = sorted[sorted.len() - 1];
    frames.iter().filter(|f| **f > MIN_LOUD).count() >= 3 && peak > floor * 1.5
}

// Was Whisper in Stille und Rauschen erfindet, stammt aus den Untertiteln seiner Trainingsdaten
const INVENTED: [&str; 12] = [
    "untertitel",
    "untertitelung",
    "amara.org",
    "vielen dank fürs zuschauen",
    "danke fürs zuschauen",
    "bis zum nächsten mal",
    "thanks for watching",
    "thank you for watching",
    "subtitles by",
    "copyright wdr",
    "swr 20",
    "ard text",
];

pub fn clean_text(raw: &str) -> Option<String> {
    let joined = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    // Geräusche stehen in Klammern: [Musik], (Husten), *Lachen*
    let mut text = String::new();
    let mut depth = 0;
    for c in joined.chars() {
        match c {
            '[' | '(' => depth += 1,
            ']' | ')' if depth > 0 => depth -= 1,
            _ if depth == 0 => text.push(c),
            _ => {}
        }
    }
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let low = text.to_lowercase();
    if !text.chars().any(char::is_alphanumeric) || low.starts_with('*') || INVENTED.iter().any(|w| low.contains(w)) {
        return None;
    }
    Some(text)
}

pub struct Chunk {
    pub start_ms: u64,
    pub samples: Vec<i16>,
}

// Teilt laufendes Audio in Abschnitte, möglichst an Pausen, damit kein Wort zerschnitten wird
pub struct Chunker {
    min: usize,
    max: usize,
    pause: usize, // so viele stille 100-ms-Stücke am Stück gelten als Pause
    buffer: Vec<i16>,
    done: u64,
}

impl Chunker {
    pub fn new(min_ms: usize, max_ms: usize, pause_ms: usize) -> Self {
        Chunker { min: min_ms * RATE / 1000, max: max_ms * RATE / 1000, pause: pause_ms / 100, buffer: Vec::new(), done: 0 }
    }

    fn take(&mut self, n: usize) -> Chunk {
        let samples: Vec<i16> = self.buffer.drain(..n).collect();
        let start_ms = self.done * 1000 / RATE as u64;
        self.done += n as u64;
        Chunk { start_ms, samples }
    }

    // Stelle zum Schneiden: Ende der ersten Pause ab min, sonst bei max die leiseste Stelle im letzten Drittel
    fn cut(&self) -> Option<usize> {
        if self.buffer.len() < self.min {
            return None;
        }
        let frames = frame_rms(&self.buffer);
        let quiet = |f: &f32| *f < MIN_LOUD;
        let first = self.min / FRAME;
        let mut run = 0;
        for (i, f) in frames.iter().enumerate() {
            run = if quiet(f) { run + 1 } else { 0 };
            if i >= first && run >= self.pause && self.pause > 0 {
                return Some(((i + 1) * FRAME).min(self.buffer.len()));
            }
        }
        if self.buffer.len() < self.max {
            return None;
        }
        let from = (self.max * 2 / 3) / FRAME;
        let to = (self.max / FRAME).min(frames.len());
        let best = (from..to).min_by(|a, b| frames[*a].total_cmp(&frames[*b])).unwrap_or(to.saturating_sub(1));
        Some(((best + 1) * FRAME).min(self.buffer.len()))
    }

    pub fn push(&mut self, samples: &[i16]) -> Vec<Chunk> {
        self.buffer.extend_from_slice(samples);
        let mut out = Vec::new();
        while let Some(n) = self.cut() {
            out.push(self.take(n));
        }
        out
    }

    pub fn flush(&mut self) -> Option<Chunk> {
        if self.buffer.is_empty() {
            None
        } else {
            let n = self.buffer.len();
            Some(self.take(n))
        }
    }
}

pub fn multipart_body(boundary: &str, fields: &[(&str, String)], wav: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(wav.len() + 512);
    for (name, value) in fields {
        out.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes());
    }
    out.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.wav\"\r\nContent-Type: audio/wav\r\n\r\n").as_bytes());
    out.extend_from_slice(wav);
    out.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    out
}

// Spuren zusammenlegen, für die Aufnahme als Anhang
pub fn mix(a: &[i16], b: &[i16]) -> Vec<i16> {
    (0..a.len().max(b.len()))
        .map(|i| {
            let (x, y) = (a.get(i).copied().unwrap_or(0) as i32, b.get(i).copied().unwrap_or(0) as i32);
            (x + y).clamp(i16::MIN as i32, i16::MAX as i32) as i16
        })
        .collect()
}

// ---- Erkennung ----

struct Server {
    child: Child,
    port: u16,
    model: String,
    used: Instant,
}

// Kind-Prozess stirbt mit Nexora, auch bei einem Absturz
fn tie_to_us(child: &Child) {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE};
    static JOB: Mutex<isize> = Mutex::new(0);
    unsafe {
        let mut job = JOB.lock().unwrap();
        if *job == 0 {
            let Ok(handle) = CreateJobObjectW(None, None) else { return };
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let _ = SetInformationJobObject(handle, JobObjectExtendedLimitInformation, &info as *const _ as _, std::mem::size_of_val(&info) as u32);
            *job = handle.0 as isize;
        }
        let _ = AssignProcessToJobObject(HANDLE(*job as _), HANDLE(child.as_raw_handle() as _));
    }
}

fn free_port() -> Result<u16, String> {
    let l = std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    Ok(l.local_addr().map_err(|e| e.to_string())?.port())
}

fn threads() -> usize {
    (std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4) / 2).clamp(2, 8)
}

#[derive(Serialize, Clone)]
struct TextEvent {
    session: u64,
    source: &'static str,
    #[serde(rename = "startMs")]
    start_ms: u64,
    #[serde(rename = "endMs")]
    end_ms: u64,
    text: String,
}

#[derive(Serialize, Clone)]
struct StateEvent {
    session: u64,
    // Sekunden Audio, die noch auf die Erkennung warten; wächst das, kommt der PC nicht hinterher
    waiting: u64,
    done: u64,
    total: u64,
    error: Option<String>,
}

struct Session {
    stop: Arc<AtomicBool>,
    finished: mpsc::Receiver<Option<PathBuf>>,
}

#[derive(Default)]
pub struct Speech {
    session: Mutex<Option<Session>>,
    server: Arc<Mutex<Option<Server>>>,
    counter: Mutex<u64>,
    cancel_download: Arc<AtomicBool>,
}

impl Speech {
    pub fn active(&self) -> bool {
        self.session.lock().unwrap().is_some()
    }
}

async fn inference(port: u16, wav: &[u8], language: &str, short_window: Option<usize>) -> Result<String, String> {
    let boundary = "nexora-grenze-7f3a9c";
    let mut fields = vec![("response_format", "json".to_string()), ("language", language.to_string())];
    if let Some(ctx) = short_window {
        fields.push(("audio_ctx", ctx.to_string()));
    }
    let res = crate::team::http_with(Duration::from_secs(600))?
        .post(format!("http://127.0.0.1:{port}/inference"))
        .header("content-type", format!("multipart/form-data; boundary={boundary}"))
        .body(multipart_body(boundary, &fields, wav))
        .send()
        .await
        .map_err(|e| e.without_url().to_string())?;
    let status = res.status();
    let body = res.text().await.map_err(|e| e.without_url().to_string())?;
    if !status.is_success() {
        return Err(format!("Die Erkennung meldet {status}: {}", body.chars().take(200).collect::<String>()));
    }
    let v: serde_json::Value = serde_json::from_str(&body).map_err(|_| "Antwort der Erkennung nicht lesbar".to_string())?;
    Ok(v["text"].as_str().unwrap_or_default().to_string())
}

// Whisper-Prozess mit dem gewünschten Modell; läuft schon einer, wird er weiterverwendet. Fertig ist er erst, wenn er wirklich erkennt
async fn ensure_server(app: &AppHandle, server: &Arc<Mutex<Option<Server>>>, model: &Model) -> Result<u16, String> {
    {
        let mut guard = server.lock().unwrap();
        if let Some(s) = guard.as_mut() {
            if s.model == model.id && matches!(s.child.try_wait(), Ok(None)) {
                s.used = Instant::now();
                return Ok(s.port);
            }
            let _ = s.child.kill();
            *guard = None;
        }
    }
    let path = dir(app)?.join(model.file);
    if !path.exists() {
        return Err("Das Sprachmodell ist noch nicht geladen (Einstellungen → Sprache)".into());
    }
    let exe = app.path().resolve("whisper/whisper-server.exe", BaseDirectory::Resource).map_err(|e| e.to_string())?;
    let port = free_port()?;
    let child = Command::new(&exe)
        .args(["-m"])
        .arg(&path)
        .args(["-t", &threads().to_string(), "--host", "127.0.0.1", "--port", &port.to_string()])
        .current_dir(exe.parent().unwrap())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Die Spracherkennung startet nicht: {e}"))?;
    tie_to_us(&child);
    *server.lock().unwrap() = Some(Server { child, port, model: model.id.into(), used: Instant::now() });
    let probe = wav_bytes(&vec![0i16; RATE / 2]);
    let start = Instant::now();
    loop {
        if inference(port, &probe, "de", None).await.is_ok() {
            return Ok(port);
        }
        let dead = server.lock().unwrap().as_mut().is_none_or(|s| !matches!(s.child.try_wait(), Ok(None)));
        if dead {
            return Err("Die Spracherkennung hat sich beendet. Fehlen dem PC Teile der Microsoft-Laufzeit, oder blockiert der Virenschutz whisper-server.exe?".into());
        }
        if start.elapsed() > Duration::from_secs(120) {
            return Err("Die Spracherkennung antwortet nicht".into());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

// Nach einer Weile ohne Aufnahme den Arbeitsspeicher wieder freigeben
fn stop_server_later(server: Arc<Mutex<Option<Server>>>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(120)).await;
        let mut guard = server.lock().unwrap();
        if guard.as_ref().is_some_and(|s| s.used.elapsed() >= Duration::from_secs(115)) {
            if let Some(mut s) = guard.take() {
                let _ = s.child.kill();
                let _ = s.child.wait();
            }
        }
    });
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StartOptions {
    mode: String, // "diktat" oder "besprechung"
    model: String,
    language: String,
    #[serde(default)]
    microphone: Option<String>,
    #[serde(default)]
    speaker: Option<String>,
    #[serde(default)]
    with_speaker: bool,
    #[serde(default)]
    keep_audio: bool,
    // Nur im Debug-Build: Dateien statt echter Geräte, damit sich der Ablauf ohne Aufnahme testen lässt
    #[serde(default)]
    test_files: Option<(String, Option<String>)>,
}

struct Job {
    source: &'static str,
    chunk: Chunk,
}

fn short_window_for(model: &Model, mode: &str, samples: usize) -> Option<usize> {
    // Das Fenster ist sonst immer 30 s lang, auch bei kurzen Stücken; verkürzt geht es schneller und etwas ungenauer
    (model.short_window || mode == "diktat").then(|| (samples * 50 / RATE + 64).min(1500))
}

// Arbeitet die Abschnitte der Reihe nach ab. Bewusst ohne den vorigen Text als Kontext: Bei kurzen Stücken gab Whisper damit
// im Test den Kontext zurück statt des Gesagten
async fn recognize(app: AppHandle, session: u64, port: u16, model: &'static Model, mode: String, language: String, jobs: mpsc::Receiver<Job>, audio_done: Arc<AtomicBool>, stop: Arc<AtomicBool>) {
    let mut queue: VecDeque<Job> = VecDeque::new();
    let file_mode = mode == "datei";
    let mut done_ms = 0u64;
    loop {
        // Erst das Ende prüfen, dann leeren: So geht nichts verloren, was kurz davor noch kam
        let ended = audio_done.load(Ordering::SeqCst);
        while let Ok(job) = jobs.try_recv() {
            queue.push_back(job);
        }
        let waiting: u64 = queue.iter().map(|j| (j.chunk.samples.len() / RATE) as u64).sum();
        let Some(job) = queue.pop_front() else {
            if ended {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
            continue;
        };
        if file_mode && stop.load(Ordering::SeqCst) {
            break;
        }
        let _ = app.emit("speech-state", StateEvent { session, waiting, done: done_ms, total: 0, error: None });
        let end_ms = job.chunk.start_ms + (job.chunk.samples.len() * 1000 / RATE) as u64;
        done_ms = end_ms;
        if !has_speech(&job.chunk.samples) {
            continue;
        }
        let wav = wav_bytes(&job.chunk.samples);
        let window = short_window_for(model, &mode, job.chunk.samples.len());
        match inference(port, &wav, &language, window).await {
            Ok(raw) => {
                if let Some(text) = clean_text(&raw) {
                    let _ = app.emit("speech-text", TextEvent { session, source: job.source, start_ms: job.chunk.start_ms, end_ms, text });
                }
            }
            Err(e) => {
                let _ = app.emit("speech-state", StateEvent { session, waiting, done: done_ms, total: 0, error: Some(e) });
            }
        }
    }
    let _ = app.emit("speech-state", StateEvent { session, waiting: 0, done: done_ms, total: 0, error: None });
}

// Rohe Spur beim Aufnehmen mitschreiben, nur wenn das Audio behalten werden soll
struct Tracks {
    dir: PathBuf,
    files: std::collections::HashMap<&'static str, fs::File>,
}
impl Tracks {
    fn write(&mut self, source: &'static str, samples: &[i16]) {
        let dir = self.dir.clone();
        let file = self.files.entry(source).or_insert_with(|| fs::File::create(dir.join(format!("{source}.pcm"))).expect("Spur anlegen"));
        let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        let _ = file.write_all(&bytes);
    }
}

fn read_track(path: &Path) -> Vec<i16> {
    fs::read(path).unwrap_or_default().chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect()
}

// Aufnahme als M4A über die Umwandlung von Windows (etwa 45 MB je Stunde statt 115 MB als WAV); klappt das nicht, bleibt es WAV
fn finish_tracks(dir: &Path) -> Option<PathBuf> {
    let (ich, andere) = (read_track(&dir.join("ich.pcm")), read_track(&dir.join("andere.pcm")));
    if ich.is_empty() && andere.is_empty() {
        return None;
    }
    let wav = dir.join("aufnahme.wav");
    fs::write(&wav, wav_bytes(&mix(&ich, &andere))).ok()?;
    let _ = fs::remove_file(dir.join("ich.pcm"));
    let _ = fs::remove_file(dir.join("andere.pcm"));
    let m4a = dir.join("aufnahme.m4a");
    match crate::capture::transcode(&wav, &m4a, crate::capture::Target::M4a) {
        Ok(()) => {
            let _ = fs::remove_file(&wav);
            Some(m4a)
        }
        Err(_) => Some(wav),
    }
}

#[tauri::command]
pub async fn speech_start(app: AppHandle, state: tauri::State<'_, Speech>, options: StartOptions) -> Result<u64, String> {
    let model = model_of(&options.model)?;
    let id = {
        let mut counter = state.counter.lock().unwrap();
        if state.active() {
            return Err("Es läuft schon eine Aufnahme".into());
        }
        *counter += 1;
        *counter
    };
    let stop = Arc::new(AtomicBool::new(false));
    let (finished_tx, finished) = mpsc::channel();
    // Sofort belegen, damit ein zweiter Start nicht dazwischenkommt, während das Modell lädt
    *state.session.lock().unwrap() = Some(Session { stop: stop.clone(), finished });
    let port = match ensure_server(&app, &state.server, model).await {
        Ok(p) => p,
        Err(e) => {
            *state.session.lock().unwrap() = None;
            return Err(e);
        }
    };

    let (audio_tx, audio_rx) = mpsc::channel::<(&'static str, Vec<i16>)>();
    let mut sources = Vec::new();
    #[cfg(debug_assertions)]
    let from_files = options.test_files.clone();
    #[cfg(not(debug_assertions))]
    let from_files: Option<(String, Option<String>)> = {
        let _ = &options.test_files;
        None
    };
    if let Some((first, second)) = from_files {
        sources.push(crate::capture::play_file(first, "ich", audio_tx.clone(), stop.clone()));
        if let Some(second) = second {
            sources.push(crate::capture::play_file(second, "andere", audio_tx.clone(), stop.clone()));
        }
    } else {
        let start = |r: Result<_, String>| r.inspect_err(|_| stop.store(true, Ordering::SeqCst));
        let opened = start(crate::capture::record(options.microphone.clone(), false, "ich", audio_tx.clone(), stop.clone())).and_then(|mic| {
            let mut list = vec![mic];
            if options.with_speaker {
                list.push(start(crate::capture::record(options.speaker.clone(), true, "andere", audio_tx.clone(), stop.clone()))?);
            }
            Ok(list)
        });
        match opened {
            Ok(list) => sources = list,
            Err(e) => {
                *state.session.lock().unwrap() = None;
                return Err(e);
            }
        }
    }
    drop(audio_tx);

    let (jobs_tx, jobs_rx) = mpsc::channel::<Job>();
    let audio_done = Arc::new(AtomicBool::new(false));
    let keep_dir = if options.keep_audio {
        let d = dir(&app)?.join(format!("aufnahme-{id}"));
        fs::create_dir_all(&d).map_err(|e| e.to_string())?;
        Some(d)
    } else {
        None
    };
    let meeting = options.mode == "besprechung";
    let keep = keep_dir.clone();
    let done_flag = audio_done.clone();
    // Abschnitte bilden: Besprechung etwa alle 10 Sekunden, Diktat an der nächsten Sprechpause
    std::thread::spawn(move || {
        let make = || if meeting { Chunker::new(8_000, 12_000, 600) } else { Chunker::new(1_500, 8_000, 500) };
        let mut chunkers: std::collections::HashMap<&'static str, Chunker> = Default::default();
        let mut tracks = keep.clone().map(|dir| Tracks { dir, files: Default::default() });
        while let Ok((source, samples)) = audio_rx.recv() {
            if let Some(t) = tracks.as_mut() {
                t.write(source, &samples);
            }
            for chunk in chunkers.entry(source).or_insert_with(make).push(&samples) {
                let _ = jobs_tx.send(Job { source, chunk });
            }
        }
        for (source, chunker) in chunkers.iter_mut() {
            if let Some(chunk) = chunker.flush() {
                let _ = jobs_tx.send(Job { source, chunk });
            }
        }
        drop(tracks);
        done_flag.store(true, Ordering::SeqCst);
    });

    let worker = recognize(app.clone(), id, port, model, options.mode.clone(), options.language.clone(), jobs_rx, audio_done, stop.clone());
    tauri::async_runtime::spawn(async move {
        worker.await;
        let audio = tauri::async_runtime::spawn_blocking(move || {
            for s in sources {
                let _ = s.join();
            }
            keep_dir.and_then(|d| finish_tracks(&d))
        })
        .await
        .ok()
        .flatten();
        let _ = finished_tx.send(audio);
    });
    Ok(id)
}

// Beendet die Aufnahme und wartet, bis alles Gesprochene erkannt ist. Ergebnis: Pfad der Aufnahme, falls behalten
#[tauri::command]
pub async fn speech_stop(state: tauri::State<'_, Speech>) -> Result<Option<String>, String> {
    let session = state.session.lock().unwrap().take();
    let Some(session) = session else { return Ok(None) };
    session.stop.store(true, Ordering::SeqCst);
    let audio = tauri::async_runtime::spawn_blocking(move || session.finished.recv().ok().flatten()).await.map_err(|e| e.to_string())?;
    if let Some(s) = state.server.lock().unwrap().as_mut() {
        s.used = Instant::now();
    }
    stop_server_later(state.server.clone());
    Ok(audio.map(|p| p.display().to_string()))
}

// Aufnahme liegt jetzt als Anhang vor: Zwischenablage aufräumen
#[tauri::command]
pub fn speech_cleanup(app: AppHandle, audio: String) -> Result<(), String> {
    let path = PathBuf::from(&audio);
    let root = dir(&app)?;
    let parent = path.parent().ok_or("Ungültiger Pfad")?;
    if parent.parent() != Some(root.as_path()) || !parent.file_name().is_some_and(|n| n.to_string_lossy().starts_with("aufnahme-")) {
        return Err("Ungültiger Pfad".into());
    }
    fs::remove_dir_all(parent).map_err(|e| e.to_string())
}

// Audiodatei einlesen: Windows wandelt sie nach 16 kHz Mono, dann dieselbe Erkennung; läuft mit speech_stop abzubrechen
#[tauri::command]
pub async fn speech_file(app: AppHandle, state: tauri::State<'_, Speech>, path: String, model: String, language: String) -> Result<u64, String> {
    let model = model_of(&model)?;
    let id = {
        let mut counter = state.counter.lock().unwrap();
        if state.active() {
            return Err("Es läuft schon eine Aufnahme".into());
        }
        *counter += 1;
        *counter
    };
    let stop = Arc::new(AtomicBool::new(false));
    let (finished_tx, finished) = mpsc::channel();
    *state.session.lock().unwrap() = Some(Session { stop: stop.clone(), finished });
    let result: Result<Vec<i16>, String> = async {
        ensure_server(&app, &state.server, model).await?;
        let source = PathBuf::from(&path);
        let temp = dir(&app)?.join(format!("datei-{id}.wav"));
        let target = temp.clone();
        let samples = tauri::async_runtime::spawn_blocking(move || {
            let converted = crate::capture::transcode(&source, &target, crate::capture::Target::Wav16k);
            let samples = converted.and_then(|_| fs::read(&target).map_err(|e| e.to_string())).and_then(|b| wav_samples(&b));
            let _ = fs::remove_file(&target);
            samples
        })
        .await
        .map_err(|e| e.to_string())??;
        Ok(samples)
    }
    .await;
    let samples = match result {
        Ok(s) => s,
        Err(e) => {
            *state.session.lock().unwrap() = None;
            return Err(format!("Die Datei lässt sich nicht lesen: {e}"));
        }
    };
    let port = state.server.lock().unwrap().as_ref().map(|s| s.port).unwrap_or_default();
    let (jobs_tx, jobs_rx) = mpsc::channel::<Job>();
    let audio_done = Arc::new(AtomicBool::new(false));
    let total = (samples.len() * 1000 / RATE) as u64;
    let mut chunker = Chunker::new(20_000, 30_000, 500);
    for chunk in chunker.push(&samples).into_iter().chain(chunker.flush()) {
        let _ = jobs_tx.send(Job { source: "datei", chunk });
    }
    drop(jobs_tx);
    audio_done.store(true, Ordering::SeqCst);
    let _ = app.emit("speech-state", StateEvent { session: id, waiting: total / 1000, done: 0, total, error: None });
    let worker = recognize(app.clone(), id, port, model, "datei".into(), language, jobs_rx, audio_done, stop);
    tauri::async_runtime::spawn(async move {
        worker.await;
        let _ = finished_tx.send(None);
    });
    Ok(id)
}

// ---- Sprachmodelle ----

#[derive(Serialize)]
pub struct ModelInfo {
    id: &'static str,
    size: u64,
    installed: bool,
}

#[tauri::command]
pub fn speech_models(app: AppHandle) -> Result<Vec<ModelInfo>, String> {
    let root = dir(&app)?;
    Ok(MODELS.iter().map(|m| ModelInfo { id: m.id, size: m.size, installed: root.join(m.file).exists() }).collect())
}

#[derive(Serialize, Clone)]
struct DownloadEvent {
    id: &'static str,
    done: u64,
    total: u64,
}

#[tauri::command]
pub async fn speech_download(app: AppHandle, state: tauri::State<'_, Speech>, id: String) -> Result<(), String> {
    let model = model_of(&id)?;
    let root = dir(&app)?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let cancel = state.cancel_download.clone();
    cancel.store(false, Ordering::SeqCst);
    let part = root.join(format!("{}.part", model.file));
    let url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}", model.file);
    // Ohne Gesamtzeit: 574 MB dauern auf langsamen Leitungen lange
    let client = crate::team::http_builder().connect_timeout(Duration::from_secs(30)).build().map_err(|e| e.to_string())?;
    let mut res = client.get(url).send().await.map_err(|e| format!("Download nicht möglich: {}", e.without_url()))?;
    if !res.status().is_success() {
        return Err(format!("Download nicht möglich ({})", res.status()));
    }
    let mut file = fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut done = 0u64;
    let mut last = Instant::now();
    let outcome: Result<(), String> = loop {
        if cancel.load(Ordering::SeqCst) {
            break Err("abgebrochen".into());
        }
        match res.chunk().await {
            Ok(Some(bytes)) => {
                hash.update(&bytes);
                if let Err(e) = file.write_all(&bytes) {
                    break Err(e.to_string());
                }
                done += bytes.len() as u64;
                if last.elapsed() > Duration::from_millis(250) {
                    last = Instant::now();
                    let _ = app.emit("speech-download", DownloadEvent { id: model.id, done, total: model.size });
                }
            }
            Ok(None) => break Ok(()),
            Err(e) => break Err(format!("Download abgebrochen: {}", e.without_url())),
        }
    };
    drop(file);
    if let Err(e) = outcome {
        let _ = fs::remove_file(&part);
        return Err(e);
    }
    let sum: String = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if sum != model.sha256 {
        let _ = fs::remove_file(&part);
        return Err("Die Prüfsumme des Modells stimmt nicht, die Datei wurde verworfen".into());
    }
    fs::rename(&part, root.join(model.file)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn speech_download_cancel(state: tauri::State<'_, Speech>) {
    state.cancel_download.store(true, Ordering::SeqCst);
}

// Für PCs, die Hugging Face nicht erreichen: Datei von Hand holen und hier einlesen; die Prüfsumme muss stimmen
#[tauri::command]
pub async fn speech_import_model(app: AppHandle, id: String, source: String) -> Result<(), String> {
    let model = model_of(&id)?;
    let root = dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let mut hash = Sha256::new();
        let mut input = fs::File::open(&source).map_err(|e| e.to_string())?;
        std::io::copy(&mut input, &mut hash).map_err(|e| e.to_string())?;
        let sum: String = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
        if sum != model.sha256 {
            return Err(format!("Das ist nicht die erwartete Datei {}", model.file));
        }
        fs::copy(&source, root.join(model.file)).map(|_| ()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn speech_delete_model(app: AppHandle, state: tauri::State<'_, Speech>, id: String) -> Result<(), String> {
    let model = model_of(&id)?;
    {
        let mut guard = state.server.lock().unwrap();
        if guard.as_ref().is_some_and(|s| s.model == model.id) {
            if let Some(mut s) = guard.take() {
                let _ = s.child.kill();
                let _ = s.child.wait();
            }
        }
    }
    match fs::remove_file(dir(&app)?.join(model.file)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(ms: usize, level: i16) -> Vec<i16> {
        (0..ms * RATE / 1000).map(|i| if i % 40 < 20 { level } else { -level }).collect()
    }
    fn silence(ms: usize) -> Vec<i16> {
        vec![0; ms * RATE / 1000]
    }

    #[test]
    fn wav_hin_und_zurueck() {
        let samples = tone(100, 1000);
        let wav = wav_bytes(&samples);
        assert_eq!(wav.len(), 44 + samples.len() * 2);
        assert_eq!(wav_samples(&wav).unwrap(), samples);
        assert!(wav_samples(b"kein wav").is_err());
        // Zusätzliche Abschnitte vor den Daten, wie sie Windows schreibt
        let mut with_extra = wav[..12].to_vec();
        with_extra.extend_from_slice(b"LIST\x03\x00\x00\x00abc\x00");
        with_extra.extend_from_slice(&wav[12..]);
        assert_eq!(wav_samples(&with_extra).unwrap(), samples);
    }

    #[test]
    fn stille_ist_keine_sprache() {
        assert!(!has_speech(&silence(5_000)));
        assert!(!has_speech(&[]));
        assert!(has_speech(&[silence(2_000), tone(1_000, 3000), silence(2_000)].concat()));
        // Gleichmäßiges Rauschen über alles: keine Sprache, kurzer Knacks auch nicht
        assert!(!has_speech(&tone(5_000, 200)));
        assert!(!has_speech(&[silence(3_000), tone(100, 8000), silence(3_000)].concat()));
        // Sprache über Rauschen
        assert!(has_speech(&[tone(2_000, 200), tone(1_000, 3000), tone(2_000, 200)].concat()));
        // Durchgehendes Reden ohne Pause, auch im kurzen Rest am Ende einer Aufnahme
        let talking: Vec<i16> = (0..20).flat_map(|i| tone(100, if i % 3 == 0 { 2500 } else { 5000 })).collect();
        assert!(has_speech(&talking));
        // Lautes, gleichmäßiges Brummen ist keine Sprache
        assert!(!has_speech(&tone(5_000, 2000)));
    }

    #[test]
    fn erfundenes_faellt_weg() {
        assert_eq!(clean_text(" Guten Morgen\n zusammen. ").as_deref(), Some("Guten Morgen zusammen."));
        assert_eq!(clean_text("Hallo [Musik] Welt (Husten)").as_deref(), Some("Hallo Welt"));
        for bad in ["", "   ", "[Musik]", "(Stille)", "...", "Untertitel im Auftrag des ZDF", "Untertitelung des ZDF, 2020", "Vielen Dank fürs Zuschauen!", "Thanks for watching!", "*Lachen*", "Untertitel der Amara.org-Community"] {
            assert_eq!(clean_text(bad), None, "{bad}");
        }
        assert!(clean_text("Vielen Dank und einen schönen Tag.").is_some());
    }

    #[test]
    fn abschnitte_an_pausen() {
        // Besprechung: 8 bis 12 s, Pause ab 600 ms
        let mut c = Chunker::new(8_000, 12_000, 600);
        let got = c.push(&[tone(9_000, 3000), silence(1_000), tone(3_000, 3000)].concat());
        assert_eq!(got.len(), 1, "an der Pause geschnitten");
        assert_eq!(got[0].start_ms, 0);
        let len = got[0].samples.len() * 1000 / RATE;
        assert!((9_500..=10_000).contains(&len), "{len}");
        let rest = c.flush().unwrap();
        assert_eq!(rest.start_ms as usize, len, "Zeit läuft weiter");
        assert!(c.flush().is_none());

        // Keine Pause: bei max an der leisesten Stelle des letzten Drittels
        let mut c = Chunker::new(8_000, 12_000, 600);
        let got = c.push(&[tone(10_000, 3000), tone(300, 100), tone(5_000, 3000)].concat());
        let len = got[0].samples.len() * 1000 / RATE;
        assert!((10_000..=10_400).contains(&len), "{len}");

        // Stückweise ankommend, nichts geht verloren
        let mut c = Chunker::new(1_500, 8_000, 500);
        let audio = [tone(2_000, 3000), silence(700), tone(2_000, 3000), silence(700), tone(500, 3000)].concat();
        let mut chunks = Vec::new();
        for part in audio.chunks(800) {
            chunks.extend(c.push(part));
        }
        chunks.extend(c.flush());
        assert_eq!(chunks.len(), 3, "zwei Pausen, Diktat schneidet schnell");
        assert_eq!(chunks.iter().map(|c| c.samples.len()).sum::<usize>(), audio.len());
    }

    #[test]
    fn formular_und_mischung() {
        let body = multipart_body("G", &[("language", "de".into())], b"AB");
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("--G\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nde\r\n"));
        assert!(text.contains("filename=\"a.wav\""));
        assert!(text.ends_with("AB\r\n--G--\r\n"));
        assert_eq!(mix(&[1, 30000], &[2, 30000, 7]), vec![3, i16::MAX, 7]);
    }

    #[test]
    fn fenster_nur_wo_noetig() {
        assert_eq!(short_window_for(&MODELS[0], "besprechung", 10 * RATE), None, "kleines Modell schafft es ohne");
        assert_eq!(short_window_for(&MODELS[0], "diktat", 4 * RATE), Some(264), "Diktat soll schnell sein");
        assert_eq!(short_window_for(&MODELS[1], "besprechung", 10 * RATE), Some(564));
        assert_eq!(short_window_for(&MODELS[1], "datei", 60 * RATE), Some(1500), "nie über die volle Länge");
    }

    #[test]
    fn modelle_vollstaendig() {
        for m in &MODELS {
            assert_eq!(m.sha256.len(), 64);
            assert!(m.file.ends_with(".bin") && m.size > 0);
        }
        assert!(model_of("gibtsnicht").is_err());
    }
}
