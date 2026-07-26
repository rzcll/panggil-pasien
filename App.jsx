import React, { useState, useEffect, useRef } from 'react';
import { Volume2, User, MapPin, Play, Loader2, AlertCircle, Settings, CheckCircle2, LogOut, Save, MessageSquare, X, RefreshCcw, Info } from 'lucide-react';

function pcmBase64ToWav(base64, sampleRate = 24000) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const buffer = new ArrayBuffer(44 + bytes.length);
  const view = new DataView(buffer);

  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + bytes.length, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); 
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); 
  writeString(view, 36, 'data');
  view.setUint32(40, bytes.length, true);

  const pcmData = new Uint8Array(buffer, 44);
  pcmData.set(bytes);

  return new Blob([buffer], { type: 'audio/wav' });
}

const fetchWithRetry = async (url, options, maxRetries = 3) => {
  const delays = [1000, 2000, 4000];
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(res => setTimeout(res, delays[i]));
    }
  }
};

export default function App() {
  // --- KONFIGURASI URL GOOGLE SCRIPT ---
  // Ganti URL ini dengan URL Web App Google Script Anda
  const GAS_URL = 'https://script.google.com/macros/s/AKfycbzkxhOF8Wa5YqKbWowv5wR0cgCogbWvxsyyWTpUgQQokRKLsIhs_zECJ_ST0iuA2yc_Qg/exec'; 

  // --- STATE LOGIN ---
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');

  // --- STATE UTAMA ---
  const [patientName, setPatientName] = useState('');
  const [address, setAddress] = useState('');
  const [room, setRoom] = useState(''); 
  const [voiceName, setVoiceName] = useState('Kore');
  const [templateText, setTemplateText] = useState('');
  
  // --- STATE UI & AUDIO ---
  const [status, setStatus] = useState('idle'); 
  const [errorMessage, setErrorMessage] = useState('');
  const [audioUrl, setAudioUrl] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  
  const audioRef = useRef(null);

  const voices = [
    { id: 'Kore', label: 'Kore (Wanita Natural)' },
    { id: 'Aoede', label: 'Aoede (Wanita Ramah)' },
    { id: 'Zephyr', label: 'Zephyr (Pria Berat)' },
    { id: 'Fenrir', label: 'Fenrir (Pria Tegas)' },
    { id: 'Leda', label: 'Leda (Wanita Profesional)' }
  ];

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const playNativeTTS = (text) => {
    return new Promise((resolve, reject) => {
      if (!('speechSynthesis' in window)) {
        reject(new Error("Browser tidak mendukung Text-to-Speech"));
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'id-ID';
      utterance.rate = 0.85;
      window.ttsUtterance = utterance;

      utterance.onend = () => {
        resolve();
        window.ttsUtterance = null;
      };
      utterance.onerror = () => {
        reject(new Error("Kesalahan sistem suara browser."));
        window.ttsUtterance = null;
      };
      window.speechSynthesis.speak(utterance);
    });
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!username.trim()) {
      setLoginError('Username tidak boleh kosong');
      return;
    }

    setLoginLoading(true);
    setLoginError('');

    try {
      const response = await fetch(`${GAS_URL}?action=login&username=${encodeURIComponent(username)}`);
      const result = await response.json();

      if (result.success) {
        setTemplateText(result.template);
        setRoom(username); // Set otomatis ruangan = username login
        setGeminiApiKey(result.apiKey || ''); 
        setIsLoggedIn(true);
      } else {
        setLoginError(result.error || 'Gagal terhubung ke sistem');
      }
    } catch (error) {
      setLoginError('Terjadi kesalahan jaringan. Periksa koneksi internet Anda.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    setSaveLoading(true);
    try {
      const response = await fetch(`${GAS_URL}?action=save&username=${encodeURIComponent(username)}&template=${encodeURIComponent(templateText)}`);
      const result = await response.json();
      if (result.success) {
        setShowSettings(false);
      } else {
        setErrorMessage("Gagal menyimpan pengaturan ke Cloud.");
      }
    } catch (error) {
      setErrorMessage("Terjadi kesalahan jaringan saat menyimpan.");
    } finally {
      setSaveLoading(false);
    }
  };

  const handleCallPatient = async () => {
    if (!patientName.trim()) {
      setErrorMessage("Silakan masukkan nama pasien terlebih dahulu.");
      return;
    }

    setErrorMessage('');
    setStatus('loading');

    let processedAddress = address.trim() ? address : "";
    let announcementText = templateText
      .replace(/{nama}/gi, patientName)
      .replace(/{ruangan}/gi, room)
      .replace(/{alamat}/gi, processedAddress);
      
    announcementText = announcementText.replace(/,\s*,/g, ',').replace(/\s+/g, ' ');

    const aiPrompt = `Say clearly, professionally, and naturally in a human voice in Indonesian: "${announcementText}"`;

    try {
      if (!geminiApiKey) {
        throw new Error("API Key tidak ditemukan di Spreadsheet.");
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${geminiApiKey}`;
      
      const payload = {
        contents: [{ parts: [{ text: aiPrompt }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } }
          }
        },
        model: "gemini-2.5-flash-preview-tts"
      };

      const data = await fetchWithRetry(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const base64Audio = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) throw new Error("Gagal menerima data suara dari AI.");

      const wavBlob = pcmBase64ToWav(base64Audio, 24000);
      const newAudioUrl = URL.createObjectURL(wavBlob);
      
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(newAudioUrl);
      
      setTimeout(async () => {
        if (audioRef.current) {
          try {
            setStatus('playing');
            await audioRef.current.play();
          } catch (playErr) {
            if (playErr.name === 'NotAllowedError') {
              setStatus('manual_play');
              setErrorMessage("Browser Anda memblokir pemutaran otomatis.");
            } else {
              throw playErr;
            }
          }
        }
      }, 100);

    } catch (err) {
      console.warn("Menggunakan fallback:", err.message);
      try {
        setStatus('playing');
        await playNativeTTS(announcementText);
        setStatus('idle');
      } catch (fallbackErr) {
        setStatus('error');
        setErrorMessage(err.message + " - Dan gagal menggunakan suara cadangan.");
      }
    }
  };

  const playManual = () => {
    if (audioRef.current) {
      setStatus('playing');
      setErrorMessage('');
      audioRef.current.currentTime = 0; 
      audioRef.current.play().catch(e => {
        setStatus('error');
        setErrorMessage("Gagal memutar audio secara manual.");
      });
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 font-sans bg-slate-50 text-slate-800">
        <div className="w-full max-w-md bg-gradient-to-br from-emerald-500 to-teal-600 rounded-[2.5rem] shadow-2xl p-8 relative overflow-hidden border border-teal-400/50">
          
          <div className="text-center mb-8 relative z-10">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-white/20 text-white mb-6 backdrop-blur-md shadow-[0_8px_16px_rgba(0,0,0,0.1)]">
              <Volume2 className="w-10 h-10" />
            </div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Sistem Antrean</h1>
            <p className="text-teal-100 text-sm mt-2 font-medium">Masuk untuk memulai panggilan AI</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6 relative z-10">
            <div>
              <label className="block text-sm font-semibold text-teal-100 mb-2 ml-2">Username Ruangan</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-teal-200" />
                </div>
                <input
                  type="text"
                  placeholder="Ketik username..."
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  // Style Cekung (Inset Shadow)
                  className="w-full pl-12 pr-5 py-4 rounded-2xl bg-teal-900/30 border border-teal-800/50 shadow-[inset_0_4px_8px_rgba(0,0,0,0.2)] text-white placeholder-teal-100/40 focus:outline-none focus:ring-2 focus:ring-white/30 transition-all font-medium text-lg"
                  required
                />
              </div>
            </div>
            
            {loginError && (
              <div className="flex items-center p-4 text-sm text-red-200 bg-red-900/40 backdrop-blur-md rounded-2xl border border-red-500/30">
                <AlertCircle className="w-5 h-5 mr-3 flex-shrink-0" />
                <span className="font-medium">{loginError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full flex items-center justify-center py-4 rounded-2xl font-bold text-teal-700 bg-white hover:bg-slate-50 shadow-[0_8px_20px_rgba(0,0,0,0.2)] transition-all transform hover:-translate-y-1 active:translate-y-0 active:scale-[0.98] disabled:opacity-80 disabled:cursor-not-allowed text-lg"
            >
              {loginLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : "Masuk"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 font-sans">
      
      {/* Top Bar Status */}
      <div className="w-full max-w-xl flex justify-between items-center mb-6 px-2">
        <div className="flex items-center px-4 py-2 bg-white rounded-full shadow-sm border border-slate-200">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 mr-2 animate-pulse"></div>
          <span className="text-sm font-bold text-slate-600">Loket: <span className="text-teal-600">{username}</span></span>
        </div>
        <button 
          onClick={() => setIsLoggedIn(false)}
          className="flex items-center px-4 py-2 bg-white hover:bg-red-50 text-slate-500 hover:text-red-600 rounded-full shadow-sm transition-all text-sm font-bold border border-slate-200"
        >
          <LogOut className="w-4 h-4 mr-2" /> Keluar
        </button>
      </div>

      {/* Main Green Card */}
      <div className="w-full max-w-xl bg-gradient-to-br from-emerald-500 to-teal-600 rounded-[2.5rem] shadow-2xl p-6 sm:p-10 relative border border-teal-400/50">
        
        {/* Header Kartu Utama */}
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Panggil Pasien
            </h1>
            <p className="text-teal-100 font-medium mt-1 text-sm">Masukkan data pasien yang akan dipanggil</p>
          </div>
          <button 
            onClick={() => setShowSettings(true)}
            className="p-3 text-white bg-white/20 hover:bg-white/30 backdrop-blur-md rounded-2xl transition-all shadow-sm border border-white/20"
            title="Pengaturan"
          >
            <Settings className="w-6 h-6" />
          </button>
        </div>

        {/* Form Input Area (Kolom Cekung) */}
        <div className="space-y-6">
          <div>
            <label className="flex items-center text-sm font-semibold text-teal-100 mb-2 ml-2 tracking-wide">
              NAMA LENGKAP
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                <User className="h-5 w-5 text-teal-200" />
              </div>
              <input
                type="text"
                placeholder="Contoh: Budi Santoso"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                // Gaya Cekung / Inset Shadow
                className="w-full pl-12 pr-5 py-4 rounded-2xl bg-teal-900/30 border border-teal-800/50 shadow-[inset_0_4px_8px_rgba(0,0,0,0.2)] text-white placeholder-teal-100/40 focus:outline-none focus:ring-2 focus:ring-white/30 transition-all font-bold text-xl"
              />
            </div>
          </div>

          <div>
            <label className="flex items-center text-sm font-semibold text-teal-100 mb-2 ml-2 tracking-wide">
              ALAMAT (OPSIONAL)
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                <MapPin className="h-5 w-5 text-teal-200" />
              </div>
              <input
                type="text"
                placeholder="Contoh: Jl. Merdeka No. 1"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                // Gaya Cekung / Inset Shadow
                className="w-full pl-12 pr-5 py-4 rounded-2xl bg-teal-900/30 border border-teal-800/50 shadow-[inset_0_4px_8px_rgba(0,0,0,0.2)] text-white placeholder-teal-100/40 focus:outline-none focus:ring-2 focus:ring-white/30 transition-all font-medium text-lg"
              />
            </div>
          </div>
        </div>

        {/* Error Alert Berwarna Merah Halus */}
        {errorMessage && (
          <div className="mt-6 flex items-center p-4 text-sm text-red-100 bg-red-900/40 backdrop-blur-md rounded-2xl border border-red-500/30">
            <AlertCircle className="w-5 h-5 mr-3 flex-shrink-0" />
            <span className="font-medium">{errorMessage}</span>
          </div>
        )}

        {/* Indikator Visual Sedang Memutar */}
        {status === 'playing' && (
          <div className="mt-6 flex items-center justify-center p-4 bg-white/10 backdrop-blur-md rounded-2xl text-white border border-white/20 shadow-inner">
            <div className="flex space-x-1.5 mr-4">
              <div className="w-1.5 h-4 bg-white rounded-full animate-[bounce_1s_infinite]"></div>
              <div className="w-1.5 h-7 bg-white rounded-full animate-[bounce_1s_infinite_100ms]"></div>
              <div className="w-1.5 h-5 bg-white rounded-full animate-[bounce_1s_infinite_200ms]"></div>
              <div className="w-1.5 h-6 bg-white rounded-full animate-[bounce_1s_infinite_300ms]"></div>
            </div>
            <span className="text-sm font-bold tracking-widest uppercase">Memanggil Pasien...</span>
          </div>
        )}

        {/* Action Buttons (Tombol Cembung/Menonjol) */}
        <div className="mt-8 space-y-4">
            {status === 'manual_play' ? (
            <button
              onClick={playManual}
              className="w-full flex items-center justify-center py-4.5 rounded-2xl font-bold text-lg text-amber-600 bg-white hover:bg-amber-50 shadow-[0_8px_20px_rgba(0,0,0,0.2)] transition-all"
            >
              <Volume2 className="w-6 h-6 mr-2" /> Putar Audio
            </button>
          ) : (
            <button
              onClick={handleCallPatient}
              disabled={status === 'loading' || status === 'playing'}
              className={`w-full flex items-center justify-center py-4 rounded-2xl font-extrabold text-xl transition-all duration-300
                ${(status === 'loading' || status === 'playing') 
                  ? 'bg-teal-800 text-teal-400 cursor-not-allowed shadow-none' 
                  : 'bg-white text-teal-700 hover:bg-slate-50 shadow-[0_10px_25px_rgba(0,0,0,0.2)] transform hover:-translate-y-1 active:translate-y-0 active:scale-[0.98]'
                }`}
            >
              {status === 'loading' ? (
                <><Loader2 className="w-6 h-6 mr-3 animate-spin" /> Menyiapkan...</>
              ) : (
                <><Volume2 className="w-7 h-7 mr-3" /> Panggil Sekarang</>
              )}
            </button>
          )}

          {/* Tombol Panggil Ulang (Transparan dengan Border) */}
          {audioUrl && (status === 'idle' || status === 'error') && (
            <button
              onClick={playManual}
              className="w-full flex items-center justify-center py-3.5 rounded-2xl font-bold text-white bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/30 shadow-sm transition-all transform active:scale-[0.98]"
            >
              <RefreshCcw className="w-5 h-5 mr-2" /> Panggil Ulang
            </button>
          )}
        </div>
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 transform transition-all">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-extrabold text-slate-800 flex items-center">
                <Settings className="w-6 h-6 mr-2 text-teal-600" /> Pengaturan Sistem
              </h2>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-700 p-2 bg-slate-100 hover:bg-slate-200 rounded-full transition-colors">
                 <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-6">
              {/* Info Ruangan */}
              <div className="p-4 bg-teal-50 rounded-2xl border border-teal-100 flex items-start">
                <Info className="w-5 h-5 text-teal-600 mr-3 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-slate-700">Ruangan Tujuan</p>
                  <p className="text-xs text-slate-500 mt-1">AI akan menyebutkan ruangan: <strong className="text-teal-700">{room}</strong> (Sesuai username login Anda).</p>
                </div>
              </div>

              {/* Template Pesan */}
              <div>
                <label className="flex items-center text-sm font-bold text-slate-700 mb-2">
                  <MessageSquare className="w-4 h-4 mr-2 text-teal-500" /> Template Pesan
                </label>
                <textarea
                  value={templateText}
                  onChange={(e) => setTemplateText(e.target.value)}
                  rows="4"
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none bg-slate-50 focus:bg-white resize-none text-sm font-medium shadow-inner"
                />
                <p className="text-[11px] text-slate-500 mt-2 leading-relaxed font-medium">
                  Gunakan <code className="text-teal-700 bg-teal-50 px-1 py-0.5 rounded">{`{nama}`}</code>, <code className="text-teal-700 bg-teal-50 px-1 py-0.5 rounded">{`{alamat}`}</code>, dan <code className="text-teal-700 bg-teal-50 px-1 py-0.5 rounded">{`{ruangan}`}</code>.<br/>
                  *Gunakan tanda koma (,) untuk memberikan jeda napas AI.
                </p>
              </div>

              {/* Tipe Suara */}
              <div>
                <label className="flex items-center text-sm font-bold text-slate-700 mb-2">
                  <User className="w-4 h-4 mr-2 text-teal-500" /> Tipe Suara AI
                </label>
                <select
                  value={voiceName}
                  onChange={(e) => setVoiceName(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none bg-slate-50 focus:bg-white text-sm font-medium cursor-pointer shadow-inner"
                >
                  {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </div>

              <button
                onClick={handleSaveSettings}
                disabled={saveLoading}
                className="w-full mt-2 flex items-center justify-center py-4 rounded-2xl font-bold text-white bg-slate-800 hover:bg-slate-900 shadow-[0_8px_20px_rgba(0,0,0,0.15)] transition-all disabled:opacity-50"
              >
                {saveLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Save className="w-5 h-5 mr-2" /> Simpan Pengaturan</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audio Element Hidden */}
      {audioUrl && (
        <audio 
          ref={audioRef} 
          src={audioUrl} 
          onEnded={() => setStatus('idle')}
          onError={() => {
            setStatus('error');
            setErrorMessage("Audio gagal diputar.");
          }}
          className="hidden" 
        />
      )}
    </div>
  );
}
