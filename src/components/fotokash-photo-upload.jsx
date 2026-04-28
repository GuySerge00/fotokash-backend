import { useState, useRef, useCallback, useEffect } from "react";

const API_BASE = "http://localhost:3001/api";

// ─── Icons ───
const Icons = {
  Upload: () => (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
  Image: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  ),
  X: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  Check: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  Calendar: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  Plus: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  Trash: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" />
    </svg>
  ),
  Camera: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
    </svg>
  ),
  AlertCircle: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
};

// ─── Simulated watermark overlay ───
const WatermarkOverlay = () => (
  <div style={{
    position: "absolute", inset: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "rgba(0,0,0,0.15)", pointerEvents: "none",
  }}>
    <div style={{
      color: "rgba(255,255,255,0.35)", fontSize: 11, fontWeight: 700,
      letterSpacing: 2, textTransform: "uppercase",
      transform: "rotate(-25deg)", userSelect: "none",
      textShadow: "0 1px 3px rgba(0,0,0,0.4)",
    }}>
      FOTOKASH
    </div>
  </div>
);

// ─── File size formatter ───
const formatSize = (bytes) => {
  if (bytes < 1024) return bytes + " o";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " Ko";
  return (bytes / 1048576).toFixed(1) + " Mo";
};

// ─── Main Component ───
export default function PhotoUploadDashboard() {
  // State
  const [files, setFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState("");
  const [events, setEvents] = useState([
    { id: "demo-1", name: "Mariage Kouamé — 12 Avril", date: "2026-04-12" },
    { id: "demo-2", name: "Baptême Yao — 19 Avril", date: "2026-04-19" },
    { id: "demo-3", name: "Corporate MTN — 25 Avril", date: "2026-04-25" },
  ]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [newEventName, setNewEventName] = useState("");
  const [newEventDate, setNewEventDate] = useState("");
  const [view, setView] = useState("grid"); // grid | list
  const fileInputRef = useRef(null);

  // ─── Drag & Drop handlers ───
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const processFiles = useCallback((newFiles) => {
    const imageFiles = Array.from(newFiles).filter((f) =>
      f.type.startsWith("image/")
    );
    const withPreviews = imageFiles.map((file) => ({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      size: file.size,
      preview: URL.createObjectURL(file),
      status: "pending", // pending | uploading | done | error
      progress: 0,
    }));
    setFiles((prev) => [...prev, ...withPreviews]);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      processFiles(e.dataTransfer.files);
    },
    [processFiles]
  );

  const handleFileSelect = useCallback(
    (e) => {
      processFiles(e.target.files);
      e.target.value = "";
    },
    [processFiles]
  );

  // ─── Remove file ───
  const removeFile = (id) => {
    setFiles((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file) URL.revokeObjectURL(file.preview);
      return prev.filter((f) => f.id !== id);
    });
  };

  // ─── Create event ───
  const createEvent = () => {
    if (!newEventName.trim()) return;
    const newEvt = {
      id: "evt-" + Date.now(),
      name: newEventName.trim(),
      date: newEventDate || new Date().toISOString().split("T")[0],
    };
    setEvents((prev) => [newEvt, ...prev]);
    setSelectedEvent(newEvt.id);
    setNewEventName("");
    setNewEventDate("");
    setShowNewEvent(false);
  };

  // ─── Upload simulation (replace with real API call) ───
  const handleUpload = async () => {
    if (!selectedEvent || files.length === 0) return;
    setUploading(true);

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.status === "done") continue;

      setFiles((prev) =>
        prev.map((x) => (x.id === f.id ? { ...x, status: "uploading" } : x))
      );

      // ── Real upload to backend ──
      try {
        const formData = new FormData();
        formData.append("photos", f.file);
        formData.append("event_id", selectedEvent);

        // Simulated progress (XHR would give real progress)
        const progressInterval = setInterval(() => {
          setFiles((prev) =>
            prev.map((x) =>
              x.id === f.id && x.status === "uploading"
                ? { ...x, progress: Math.min(x.progress + 15, 90) }
                : x
            )
          );
        }, 200);

        const token = localStorage.getItem("fotokash_token");
        const res = await fetch(`${API_BASE}/photos/upload`, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        });

        clearInterval(progressInterval);

        if (res.ok) {
          setFiles((prev) =>
            prev.map((x) =>
              x.id === f.id ? { ...x, status: "done", progress: 100 } : x
            )
          );
        } else {
          throw new Error("Upload failed");
        }
      } catch (err) {
        setFiles((prev) =>
          prev.map((x) =>
            x.id === f.id ? { ...x, status: "error", progress: 0 } : x
          )
        );
      }
    }

    setUploading(false);
  };

  // ─── Stats ───
  const totalSize = files.reduce((acc, f) => acc + f.size, 0);
  const doneCount = files.filter((f) => f.status === "done").length;
  const errorCount = files.filter((f) => f.status === "error").length;
  const pendingCount = files.filter(
    (f) => f.status === "pending" || f.status === "uploading"
  ).length;

  // ─── Cleanup previews on unmount ───
  useEffect(() => {
    return () => files.forEach((f) => URL.revokeObjectURL(f.preview));
  }, []);

  // ─── Styles ───
  const accent = "#E8593C";
  const accentDim = "rgba(232,89,60,0.15)";
  const bg = "#0D0D10";
  const card = "#16161D";
  const cardAlt = "#1C1C26";
  const border = "rgba(255,255,255,0.06)";
  const textMuted = "#8888A0";

  return (
    <div
      style={{
        fontFamily: "'DM Sans', system-ui, sans-serif",
        background: bg,
        color: "#F0F0F5",
        minHeight: "100vh",
        padding: "24px",
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          marginBottom: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              margin: 0,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <Icons.Camera />
            <span>Uploader des photos</span>
          </h1>
          <p style={{ color: textMuted, fontSize: 13, marginTop: 4 }}>
            Ajoutez vos photos à un événement pour les rendre disponibles à la
            vente
          </p>
        </div>
        {files.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 12,
              fontSize: 12,
              color: textMuted,
            }}
          >
            <span>
              <strong style={{ color: "#F0F0F5" }}>{files.length}</strong>{" "}
              photo{files.length > 1 ? "s" : ""}
            </span>
            <span>·</span>
            <span>{formatSize(totalSize)}</span>
            {doneCount > 0 && (
              <>
                <span>·</span>
                <span style={{ color: "#4ADE80" }}>
                  {doneCount} envoyée{doneCount > 1 ? "s" : ""}
                </span>
              </>
            )}
            {errorCount > 0 && (
              <>
                <span>·</span>
                <span style={{ color: accent }}>
                  {errorCount} erreur{errorCount > 1 ? "s" : ""}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        {/* ── Event selector ── */}
        <div
          style={{
            background: card,
            borderRadius: 14,
            border: `1px solid ${border}`,
            padding: "20px 24px",
            marginBottom: 20,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              <Icons.Calendar />
              Événement
            </div>
            <button
              onClick={() => setShowNewEvent(!showNewEvent)}
              style={{
                background: accentDim,
                color: accent,
                border: "none",
                borderRadius: 8,
                padding: "6px 14px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "rgba(232,89,60,0.25)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = accentDim)
              }
            >
              <Icons.Plus /> Nouvel événement
            </button>
          </div>

          {/* New event form */}
          {showNewEvent && (
            <div
              style={{
                background: cardAlt,
                borderRadius: 10,
                padding: 16,
                marginBottom: 14,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "flex-end",
                animation: "fadeIn 0.2s ease",
              }}
            >
              <div style={{ flex: "1 1 200px" }}>
                <label
                  style={{
                    fontSize: 11,
                    color: textMuted,
                    display: "block",
                    marginBottom: 4,
                  }}
                >
                  Nom de l'événement
                </label>
                <input
                  value={newEventName}
                  onChange={(e) => setNewEventName(e.target.value)}
                  placeholder="Ex: Mariage Diallo"
                  style={{
                    width: "100%",
                    background: bg,
                    border: `1px solid ${border}`,
                    borderRadius: 8,
                    padding: "10px 14px",
                    color: "#F0F0F5",
                    fontSize: 13,
                    outline: "none",
                  }}
                  onFocus={(e) =>
                    (e.target.style.borderColor = accent)
                  }
                  onBlur={(e) =>
                    (e.target.style.borderColor = border)
                  }
                />
              </div>
              <div style={{ flex: "0 1 160px" }}>
                <label
                  style={{
                    fontSize: 11,
                    color: textMuted,
                    display: "block",
                    marginBottom: 4,
                  }}
                >
                  Date
                </label>
                <input
                  type="date"
                  value={newEventDate}
                  onChange={(e) => setNewEventDate(e.target.value)}
                  style={{
                    width: "100%",
                    background: bg,
                    border: `1px solid ${border}`,
                    borderRadius: 8,
                    padding: "10px 14px",
                    color: "#F0F0F5",
                    fontSize: 13,
                    outline: "none",
                    colorScheme: "dark",
                  }}
                />
              </div>
              <button
                onClick={createEvent}
                disabled={!newEventName.trim()}
                style={{
                  background: accent,
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 20px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: newEventName.trim() ? "pointer" : "not-allowed",
                  opacity: newEventName.trim() ? 1 : 0.4,
                  transition: "all 0.2s",
                  whiteSpace: "nowrap",
                }}
              >
                Créer
              </button>
            </div>
          )}

          {/* Event select */}
          <select
            value={selectedEvent}
            onChange={(e) => setSelectedEvent(e.target.value)}
            style={{
              width: "100%",
              background: bg,
              border: `1px solid ${selectedEvent ? accent : border}`,
              borderRadius: 10,
              padding: "12px 16px",
              color: selectedEvent ? "#F0F0F5" : textMuted,
              fontSize: 14,
              outline: "none",
              cursor: "pointer",
              appearance: "auto",
              colorScheme: "dark",
              transition: "border-color 0.2s",
            }}
          >
            <option value="">— Sélectionner un événement —</option>
            {events.map((evt) => (
              <option key={evt.id} value={evt.id}>
                {evt.name}
              </option>
            ))}
          </select>
        </div>

        {/* ── Drop zone ── */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            background: dragOver ? accentDim : card,
            borderRadius: 14,
            border: `2px dashed ${dragOver ? accent : "rgba(255,255,255,0.1)"}`,
            padding: "48px 24px",
            textAlign: "center",
            cursor: "pointer",
            transition: "all 0.3s ease",
            marginBottom: 20,
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Subtle bg pattern */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: 0.03,
              backgroundImage: `radial-gradient(circle at 20% 50%, ${accent} 1px, transparent 1px), radial-gradient(circle at 80% 20%, ${accent} 1px, transparent 1px)`,
              backgroundSize: "60px 60px",
              pointerEvents: "none",
            }}
          />
          <div style={{ position: "relative" }}>
            <div
              style={{
                color: dragOver ? accent : textMuted,
                marginBottom: 16,
                transition: "color 0.2s",
              }}
            >
              <Icons.Upload />
            </div>
            <p
              style={{
                fontSize: 15,
                fontWeight: 600,
                marginBottom: 6,
                color: dragOver ? "#F0F0F5" : textMuted,
              }}
            >
              {dragOver
                ? "Déposez vos photos ici"
                : "Glissez-déposez vos photos"}
            </p>
            <p style={{ fontSize: 12, color: textMuted }}>
              ou{" "}
              <span
                style={{
                  color: accent,
                  fontWeight: 600,
                  textDecoration: "underline",
                  textUnderlineOffset: 2,
                }}
              >
                parcourir vos fichiers
              </span>{" "}
              · JPG, PNG, WebP · Max 25 Mo par photo
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            style={{ display: "none" }}
          />
        </div>

        {/* ── Photo grid ── */}
        {files.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            {/* Grid/List toggle + clear */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 14,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                Aperçu ({files.length} photo{files.length > 1 ? "s" : ""})
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() =>
                    setFiles((prev) =>
                      prev.filter((f) => f.status !== "done")
                    )
                  }
                  style={{
                    background: "transparent",
                    color: textMuted,
                    border: `1px solid ${border}`,
                    borderRadius: 8,
                    padding: "6px 12px",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  Retirer les envoyées
                </button>
                <button
                  onClick={() => {
                    files.forEach((f) => URL.revokeObjectURL(f.preview));
                    setFiles([]);
                  }}
                  style={{
                    background: "rgba(239,68,68,0.1)",
                    color: "#EF4444",
                    border: "none",
                    borderRadius: 8,
                    padding: "6px 12px",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Tout supprimer
                </button>
              </div>
            </div>

            {/* Photo grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: 10,
              }}
            >
              {files.map((f) => (
                <div
                  key={f.id}
                  style={{
                    position: "relative",
                    borderRadius: 10,
                    overflow: "hidden",
                    background: cardAlt,
                    border: `1px solid ${
                      f.status === "error"
                        ? "rgba(239,68,68,0.4)"
                        : f.status === "done"
                        ? "rgba(74,222,128,0.3)"
                        : border
                    }`,
                    aspectRatio: "1",
                    transition: "all 0.2s",
                  }}
                >
                  {/* Image */}
                  <img
                    src={f.preview}
                    alt={f.name}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />

                  {/* Watermark preview */}
                  <WatermarkOverlay />

                  {/* Progress overlay */}
                  {f.status === "uploading" && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "rgba(0,0,0,0.6)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: "50%",
                          border: `3px solid rgba(255,255,255,0.1)`,
                          borderTopColor: accent,
                          animation: "spin 0.8s linear infinite",
                        }}
                      />
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#fff",
                        }}
                      >
                        {f.progress}%
                      </span>
                    </div>
                  )}

                  {/* Done overlay */}
                  {f.status === "done" && (
                    <div
                      style={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        background: "#4ADE80",
                        borderRadius: "50%",
                        width: 24,
                        height: 24,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Icons.Check />
                    </div>
                  )}

                  {/* Error overlay */}
                  {f.status === "error" && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "rgba(239,68,68,0.15)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <div
                        style={{
                          background: "rgba(0,0,0,0.7)",
                          borderRadius: 8,
                          padding: "6px 10px",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          color: "#EF4444",
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        <Icons.AlertCircle /> Erreur
                      </div>
                    </div>
                  )}

                  {/* Remove button */}
                  {f.status !== "uploading" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(f.id);
                      }}
                      style={{
                        position: "absolute",
                        top: 6,
                        left: 6,
                        background: "rgba(0,0,0,0.65)",
                        border: "none",
                        borderRadius: "50%",
                        width: 24,
                        height: 24,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        cursor: "pointer",
                        opacity: 0.7,
                        transition: "opacity 0.15s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.opacity = 1)}
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.opacity = 0.7)
                      }
                    >
                      <Icons.X />
                    </button>
                  )}

                  {/* File info */}
                  <div
                    style={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      right: 0,
                      background:
                        "linear-gradient(transparent, rgba(0,0,0,0.75))",
                      padding: "20px 8px 8px",
                    }}
                  >
                    <p
                      style={{
                        fontSize: 10,
                        color: "#fff",
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        margin: 0,
                      }}
                    >
                      {f.name}
                    </p>
                    <p style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", margin: 0 }}>
                      {formatSize(f.size)}
                    </p>
                  </div>

                  {/* Progress bar at bottom */}
                  {f.status === "uploading" && (
                    <div
                      style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: 3,
                        background: "rgba(255,255,255,0.1)",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${f.progress}%`,
                          background: accent,
                          borderRadius: 2,
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}

              {/* Add more photos tile */}
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  borderRadius: 10,
                  border: `2px dashed rgba(255,255,255,0.1)`,
                  aspectRatio: "1",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  cursor: "pointer",
                  color: textMuted,
                  transition: "all 0.2s",
                  background: "transparent",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = accent;
                  e.currentTarget.style.color = accent;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
                  e.currentTarget.style.color = textMuted;
                }}
              >
                <Icons.Plus />
                <span style={{ fontSize: 11, fontWeight: 500 }}>Ajouter</span>
              </div>
            </div>
          </div>
        )}

        {/* ── Upload button ── */}
        {files.length > 0 && (
          <div
            style={{
              background: card,
              borderRadius: 14,
              border: `1px solid ${border}`,
              padding: "20px 24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div>
              {!selectedEvent && (
                <p
                  style={{
                    fontSize: 12,
                    color: accent,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    margin: 0,
                  }}
                >
                  <Icons.AlertCircle />
                  Sélectionnez un événement avant d'envoyer
                </p>
              )}
              {selectedEvent && pendingCount > 0 && (
                <p style={{ fontSize: 13, color: textMuted, margin: 0 }}>
                  <strong style={{ color: "#F0F0F5" }}>{pendingCount}</strong>{" "}
                  photo{pendingCount > 1 ? "s" : ""} prête
                  {pendingCount > 1 ? "s" : ""} à envoyer ·{" "}
                  {formatSize(
                    files
                      .filter(
                        (f) =>
                          f.status === "pending" || f.status === "uploading"
                      )
                      .reduce((acc, f) => acc + f.size, 0)
                  )}
                </p>
              )}
              {selectedEvent && pendingCount === 0 && doneCount > 0 && (
                <p
                  style={{
                    fontSize: 13,
                    color: "#4ADE80",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    margin: 0,
                  }}
                >
                  <Icons.Check />
                  Toutes les photos ont été envoyées !
                </p>
              )}
            </div>

            <button
              onClick={handleUpload}
              disabled={
                !selectedEvent || pendingCount === 0 || uploading
              }
              style={{
                background:
                  !selectedEvent || pendingCount === 0 || uploading
                    ? "rgba(255,255,255,0.05)"
                    : accent,
                color:
                  !selectedEvent || pendingCount === 0 || uploading
                    ? textMuted
                    : "#fff",
                border: "none",
                borderRadius: 10,
                padding: "12px 32px",
                fontSize: 14,
                fontWeight: 700,
                cursor:
                  !selectedEvent || pendingCount === 0 || uploading
                    ? "not-allowed"
                    : "pointer",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                gap: 8,
                letterSpacing: "0.02em",
              }}
            >
              {uploading ? (
                <>
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      border: "2px solid rgba(255,255,255,0.2)",
                      borderTopColor: "#fff",
                      animation: "spin 0.6s linear infinite",
                    }}
                  />
                  Envoi en cours...
                </>
              ) : (
                <>
                  <Icons.Upload />
                  Envoyer {pendingCount > 0 ? `(${pendingCount})` : ""}
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* ── Keyframes ── */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@700&display=swap');
      `}</style>
    </div>
  );
}
