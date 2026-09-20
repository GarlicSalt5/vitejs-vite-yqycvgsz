import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import {
  Plus, X, Check, ChevronRight, ChevronDown, Timer, Dumbbell, TrendingUp,
  History, Scale, Trash2, Pencil, FolderPlus, Folder
} from "lucide-react";
import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL = "https://nebkjkoqstpbycgqnmvt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5lYmtqa29xc3RwYnljZ3FubXZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3Nzc1NDksImV4cCI6MjEwNTM1MzU0OX0.8sMesmZxiY5dYd6eeCcH6lO-FhGKd7T7kWcxn_3vw2c";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const MUSCLES = { chest: "Chest", back: "Back", shoulders: "Shoulders", arms: "Arms", legs: "Legs", core: "Core" };

const BASE_EXERCISES = [
  { id: "bench-db", name: "Bench Press (Dumbbell)", muscle: "chest" },
  { id: "incline-db", name: "Incline Bench Press (Dumbbell)", muscle: "chest" },
  { id: "lat-pulldown", name: "Lat Pulldown (Cable)", muscle: "back" },
  { id: "seated-row", name: "Seated Row (Cable)", muscle: "back" },
  { id: "lateral-raise", name: "Lateral Raise (Dumbbell)", muscle: "shoulders" },
  { id: "landmine-press", name: "Landmine Press", muscle: "shoulders" },
  { id: "skullcrusher", name: "Skullcrusher (Dumbbell)", muscle: "arms" },
  { id: "bicep-curl", name: "Bicep Curl (Dumbbell)", muscle: "arms" },
  { id: "squat", name: "Squat (Barbell)", muscle: "legs" },
  { id: "leg-press", name: "Leg Press", muscle: "legs" },
  { id: "rdl", name: "Romanian Deadlift", muscle: "legs" },
  { id: "plank", name: "Plank", muscle: "core" },
];

const exById = (library, id) => (library || BASE_EXERCISES).find((e) => e.id === id) || { id, name: id, muscle: "custom" };

const DEFAULT_TEMPLATES = [
  {
    id: "upper-a", name: "Upper A", folderId: "split",
    exercises: [
      { exId: "bench-db", sets: 3, rest: 120 },
      { exId: "lat-pulldown", sets: 3, rest: 120 },
      { exId: "incline-db", sets: 2, rest: 120 },
      { exId: "seated-row", sets: 3, rest: 90 },
      { exId: "lateral-raise", sets: 3, rest: 60 },
      { exId: "skullcrusher", sets: 2, rest: 60 },
      { exId: "bicep-curl", sets: 3, rest: 60 },
    ],
  },
  {
    id: "lower-a", name: "Lower A", folderId: "split",
    exercises: [
      { exId: "squat", sets: 4, rest: 150 },
      { exId: "leg-press", sets: 3, rest: 120 },
      { exId: "rdl", sets: 3, rest: 120 },
      { exId: "plank", sets: 3, rest: 45 },
    ],
  },
];

const DEFAULT_FOLDERS = [{ id: "split", name: "Upper/Lower 4-day" }];

const REST_PRESETS = [30, 60, 90, 120, 180, 300];

const uid = () => Math.random().toString(36).slice(2, 10);

// Appending 'T12:00:00' to YYYY-MM-DD prevents localized timezone shift bugs
const fmtDate = (iso) => new Date(iso.includes('T') ? iso : iso + 'T12:00:00').toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtDateFull = (iso) => new Date(iso.includes('T') ? iso : iso + 'T12:00:00').toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

const fmtClock = (secs) => {
  const s = Math.max(0, Math.round(secs));
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const r = (s % 60).toString().padStart(2, "0");
  return `${m}:${r}`;
};

// 0 reps yields 0. 1 rep yields actual weight. >1 calculates max.
const est1RM = (w, r) => (r === 0 ? 0 : r === 1 ? w : Math.round(w * (1 + r / 30) * 10) / 10);

const normalizeReps = (v) => {
  const t = v.trim();
  if (t.toUpperCase() === "F" || t.toUpperCase() === "W") return t.toUpperCase();
  return v;
};
const repsTag = (v) => {
  const t = String(v).trim().toUpperCase();
  return t === "F" || t === "W" ? t : null;
};

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const STORAGE_KEY = "ironlog:v2"; // now used only as the local fast-cache key

const emptyData = () => ({ history: [], bodyweight: [], templates: DEFAULT_TEMPLATES, folders: DEFAULT_FOLDERS, customExercises: [] });

function parseStored(raw) {
  const d = typeof raw === "string" ? JSON.parse(raw) : raw;
  return {
    history: d.history || [],
    bodyweight: d.bodyweight || [],
    templates: d.templates || DEFAULT_TEMPLATES,
    folders: d.folders || DEFAULT_FOLDERS,
    customExercises: d.customExercises || [],
  };
}

// Local cache: makes reopening the app feel instant, and is an offline copy.
function readLocalCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseStored(raw) : null;
  } catch (e) { return null; }
}
function writeLocalCache(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
}

// Supabase (per signed-in user) is the source of truth once someone is
// logged in. Falls back to Claude's artifact storage when running as a
// Claude artifact preview, and to the local cache if Supabase can't be
// reached (offline, first load before auth resolves, etc).
async function loadData(userId) {
  try {
    if (typeof window !== "undefined" && window.storage && window.storage.get) {
      const res = await window.storage.get(STORAGE_KEY, false);
      return res && res.value ? parseStored(res.value) : emptyData();
    }
    if (userId) {
      const { data, error } = await supabase
        .from("workout_data")
        .select("data")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      if (data && data.data) {
        const parsed = parseStored(data.data);
        writeLocalCache(parsed);
        return parsed;
      }
      // First time this account has ever loaded — seed a row.
      const fresh = emptyData();
      await supabase.from("workout_data").upsert({ user_id: userId, data: fresh });
      writeLocalCache(fresh);
      return fresh;
    }
  } catch (e) {
    console.error("Supabase load failed, using local cache instead", e);
  }
  return readLocalCache() || emptyData();
}

async function saveData(userId, data) {
  writeLocalCache(data); // instant local backup regardless of network
  try {
    if (typeof window !== "undefined" && window.storage && window.storage.set) {
      await window.storage.set(STORAGE_KEY, JSON.stringify(data), false);
      return;
    }
    if (userId) {
      const { error } = await supabase
        .from("workout_data")
        .upsert({ user_id: userId, data, updated_at: new Date().toISOString() });
      if (error) throw error;
    }
  } catch (e) {
    console.error("Supabase save failed — change is kept in the local cache", e);
  }
}

// ---------------------------------------------------------------------------
// Auth gate — email magic-link sign-in, then renders the app
// ---------------------------------------------------------------------------

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = checking, null = signed out

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => listener.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="app">
        <style>{CSS}</style>
        <div className="auth-loading">Loading…</div>
      </div>
    );
  }

  if (!session) return <AuthScreen />;

  return (
    <IronLog
      userId={session.user.id}
      userEmail={session.user.email}
      onSignOut={() => supabase.auth.signOut()}
    />
  );
}

function AuthScreen() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  const sendLink = async () => {
    if (!email.trim() || sending) return;
    setSending(true);
    setError("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.href },
    });
    setSending(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  return (
    <div className="app">
      <style>{CSS}</style>
      <div className="auth-screen">
        <Dumbbell size={32} color="var(--accent)" />
        <h1 className="h1">IronLog</h1>
        <p className="sub">Sign in to keep your workouts saved to your account.</p>
        {sent ? (
          <div className="auth-sent">Check <b>{email}</b> for a sign-in link, then come back here.</div>
        ) : (
          <>
            <input
              className="set-input wide" placeholder="you@email.com" value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendLink()}
            />
            {error && <div className="auth-error">{error}</div>}
            <button className="btn-finish wide" onClick={sendLink} disabled={sending}>
              {sending ? "Sending…" : "Send magic link"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root App
// ---------------------------------------------------------------------------

function IronLog({ userId, userEmail, onSignOut }) {
  const [tab, setTab] = useState("train");
  const [history, setHistory] = useState([]);
  const [bodyweight, setBodyweight] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [folders, setFolders] = useState([]);
  const [customExercises, setCustomExercises] = useState([]);
  const [activeWorkout, setActiveWorkout] = useState(null);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const library = useMemo(() => [...BASE_EXERCISES, ...customExercises], [customExercises]);

  useEffect(() => {
    setLoaded(false);
    loadData(userId).then((d) => {
      setHistory(d.history);
      setBodyweight(d.bodyweight);
      setTemplates(d.templates);
      setFolders(d.folders);
      setCustomExercises(d.customExercises);
      setLoaded(true);
    });
  }, [userId]);

  useEffect(() => {
    if (!loaded) return;
    saveData(userId, { history, bodyweight, templates, folders, customExercises });
  }, [history, bodyweight, templates, folders, customExercises, loaded, userId]);

  const addCustomExercise = (ex) => setCustomExercises((ces) => [...ces, ex]);

  const finishWorkout = (session) => {
    const cleaned = {
      ...session,
      exercises: session.exercises.map((ex) => ({
        ...ex,
        sets: ex.sets.filter((s) => s.completed),
      })).filter((ex) => ex.sets.length > 0),
      endedAt: new Date().toISOString(),
    };
    if (cleaned.exercises.length > 0) setHistory((h) => [cleaned, ...h]);
    setActiveWorkout(null);
    setTab("history");
  };

  const saveTemplate = (tpl) => {
    setTemplates((ts) => {
      const exists = ts.some((t) => t.id === tpl.id);
      return exists ? ts.map((t) => (t.id === tpl.id ? tpl : t)) : [...ts, tpl];
    });
    setEditingTemplate(null);
  };
  const deleteTemplate = (id) => {
    setTemplates((ts) => ts.filter((t) => t.id !== id));
    setEditingTemplate(null);
  };
  const createFolder = (name) => {
    const f = { id: uid(), name };
    setFolders((fs) => [...fs, f]);
    return f.id;
  };
  const renameFolder = (id, name) => setFolders((fs) => fs.map((f) => (f.id === id ? { ...f, name } : f)));
  const deleteFolder = (id) => {
    setFolders((fs) => fs.filter((f) => f.id !== id));
    setTemplates((ts) => ts.map((t) => (t.folderId === id ? { ...t, folderId: null } : t)));
  };

  return (
    <div className="app">
      <style>{CSS}</style>
      {!activeWorkout && userEmail && (
        <div className="account-bar">
          <span>{userEmail}</span>
          <button className="account-signout" onClick={onSignOut}>Sign out</button>
        </div>
      )}
      <div className="screen">
        {activeWorkout ? (
          <ActiveSession
            session={activeWorkout}
            setSession={setActiveWorkout}
            onFinish={finishWorkout}
            onDiscard={() => setActiveWorkout(null)}
            library={library}
            onCreateCustomExercise={addCustomExercise}
          />
        ) : (
          <>
            {tab === "train" && (
              <TrainTab
                onStart={setActiveWorkout}
                history={history}
                templates={templates}
                folders={folders}
                library={library}
                onEditTemplate={setEditingTemplate}
                onNewTemplate={() => setEditingTemplate("new")}
                onDeleteTemplate={deleteTemplate}
                onCreateFolder={createFolder}
                onRenameFolder={renameFolder}
                onDeleteFolder={deleteFolder}
              />
            )}
            {tab === "history" && <HistoryTab history={history} library={library} onDelete={(id) => setHistory((h) => h.filter((w) => w.id !== id))} />}
            {tab === "progress" && <ProgressTab history={history} library={library} bodyweight={bodyweight} setBodyweight={setBodyweight} />}
          </>
        )}
      </div>

      {!activeWorkout && (
        <nav className="tabbar">
          <button className={`tabbtn ${tab === "train" ? "active" : ""}`} onClick={() => setTab("train")}>
            <Dumbbell size={20} /> <span>Train</span>
          </button>
          <button className={`tabbtn ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>
            <History size={20} /> <span>History</span>
          </button>
          <button className={`tabbtn ${tab === "progress" ? "active" : ""}`} onClick={() => setTab("progress")}>
            <TrendingUp size={20} /> <span>Progress</span>
          </button>
        </nav>
      )}

      {editingTemplate && (
        <TemplateEditor
          template={editingTemplate === "new" ? null : editingTemplate}
          folders={folders}
          library={library}
          onCreateCustomExercise={addCustomExercise}
          onSave={saveTemplate}
          onDelete={deleteTemplate}
          onClose={() => setEditingTemplate(null)}
          onCreateFolder={createFolder}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reusable: Rest picker sheet
// ---------------------------------------------------------------------------

function RestPickerSheet({ value, onPick, onClose }) {
  const [custom, setCustom] = useState("");
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span>Rest timer</span>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="rest-preset-grid">
          {REST_PRESETS.map((s) => (
            <button key={s} className={`rest-preset ${value === s ? "on" : ""}`} onClick={() => { onPick(s); onClose(); }}>
              {fmtClock(s)}
            </button>
          ))}
        </div>
        <div className="add-row" style={{ marginTop: 14 }}>
          <input
            className="set-input wide" inputMode="numeric" placeholder="Custom seconds"
            value={custom} onChange={(e) => setCustom(e.target.value)}
          />
          <button
            className="btn-small"
            onClick={() => { const v = parseInt(custom, 10); if (v > 0) { onPick(v); onClose(); } }}
          >
            Set
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template card
// ---------------------------------------------------------------------------

const LONG_PRESS_MS = 480;

function TemplateCard({ tpl, library, lastLabel, isMenuOpen, onOpenMenu, onCloseMenu, onStart, onEdit, onDeleteRequest }) {
  const timerRef = useRef(null);
  const longPressRef = useRef(false);

  const startPress = () => {
    longPressRef.current = false;
    timerRef.current = setTimeout(() => {
      longPressRef.current = true;
      onOpenMenu();
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => { if (timerRef.current) clearTimeout(timerRef.current); };

  const handleClick = () => {
    if (longPressRef.current) { longPressRef.current = false; return; }
    if (isMenuOpen) { onCloseMenu(); return; }
    onStart(tpl);
  };

  const handleContextMenu = (e) => { e.preventDefault(); onOpenMenu(); };

  return (
    <div className={`tpl-card ${isMenuOpen ? "menu-open" : ""}`}>
      <div
        className="tpl-card-top"
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
      >
        <div>
          <div className="tpl-name">{tpl.name}</div>
          <div className="tpl-meta">{tpl.exercises.length ? tpl.exercises.map((e) => exById(library, e.exId).name).join(" · ") : "No exercises yet"}</div>
          {lastLabel && <div className="tpl-last">Last done {lastLabel}</div>}
        </div>
        <ChevronRight size={20} color="var(--muted)" />
      </div>
      {isMenuOpen && (
        <div className="tpl-card-actions">
          <button className="tpl-action" onClick={() => { onEdit(tpl); onCloseMenu(); }}><Pencil size={13} /> Edit</button>
          <button className="tpl-action danger" onClick={() => { onDeleteRequest(tpl); onCloseMenu(); }}><Trash2 size={13} /> Delete</button>
        </div>
      )}
      {!isMenuOpen && <div className="tpl-hint">Hold or right-click for options</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reusable: Exercise picker
// ---------------------------------------------------------------------------

function ExercisePickerSheet({ library, onPick, onClose, onCreateCustom }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [muscle, setMuscle] = useState("chest");

  const submitCustom = () => {
    if (!name.trim()) return;
    const ex = { id: `custom-${uid()}`, name: name.trim(), muscle, custom: true };
    onCreateCustom(ex);
    onPick(ex.id);
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><span>Add exercise</span><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>

        {!creating ? (
          <button className="btn-empty" onClick={() => setCreating(true)}><Plus size={16} /> Create custom exercise</button>
        ) : (
          <div className="custom-ex-form">
            <input className="set-input wide" placeholder="Exercise name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <select className="set-input wide" value={muscle} onChange={(e) => setMuscle(e.target.value)}>
              {Object.entries(MUSCLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <div className="add-row">
              <button className="btn-small" onClick={submitCustom}>Add &amp; select</button>
              <button className="ghost-btn" onClick={() => setCreating(false)}>Cancel</button>
            </div>
          </div>
        )}

        <div className="sheet-list">
          {library.map((e) => (
            <div key={e.id} className="sheet-item" onClick={() => onPick(e.id)}>
              <div>
                <div className="sheet-item-name">{e.name}</div>
                <div className="sheet-item-muscle">{MUSCLES[e.muscle] || "Custom"}{e.custom ? " · Custom" : ""}</div>
              </div>
              <Plus size={16} color="var(--accent)" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Train tab
// ---------------------------------------------------------------------------

function TrainTab({
  onStart, history, templates, folders, library, onEditTemplate, onNewTemplate,
  onDeleteTemplate, onCreateFolder, onRenameFolder, onDeleteFolder,
}) {
  const [addingFolder, setAddingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [collapsed, setCollapsed] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [renameVal, setRenameVal] = useState("");
  const [menuOpenId, setMenuOpenId] = useState(null);

  const lastFor = (tpl) => {
    const found = history.find((h) => h.templateId === tpl.id);
    return found ? fmtDateFull(found.startedAt) : null;
  };

  const startFromTemplate = (tpl) => {
    onStart({
      id: uid(), templateId: tpl.id, name: tpl.name, startedAt: new Date().toISOString(),
      exercises: tpl.exercises.map((e) => ({
        id: uid(), // Assured distinct exercise IDs for safety
        exId: e.exId, rest: e.rest || 120,
        sets: Array.from({ length: e.sets }).map(() => ({ id: uid(), weight: "", reps: "", completed: false })),
      })),
    });
  };
  const startEmpty = () => onStart({ id: uid(), templateId: null, name: "Workout", startedAt: new Date().toISOString(), exercises: [] });

  const grouped = folders.map((f) => ({ folder: f, items: templates.filter((t) => t.folderId === f.id) }));
  const unfiled = templates.filter((t) => !t.folderId || !folders.some((f) => f.id === t.folderId));

  const renderTemplateCard = (tpl) => (
    <TemplateCard
      key={tpl.id}
      tpl={tpl}
      library={library}
      lastLabel={lastFor(tpl)}
      isMenuOpen={menuOpenId === tpl.id}
      onOpenMenu={() => setMenuOpenId(tpl.id)}
      onCloseMenu={() => setMenuOpenId(null)}
      onStart={startFromTemplate}
      onEdit={onEditTemplate}
      onDeleteRequest={(t) => setConfirmDelete({ type: "template", id: t.id, name: t.name })}
    />
  );

  return (
    <div className="pad">
      <h1 className="h1">Train</h1>
      <p className="sub">Pick up where the split left off.</p>

      <button className="btn-empty" onClick={startEmpty}><Plus size={18} /> Start an empty session</button>

      <div className="section-label-row">
        <div className="section-label">Templates</div>
        <div className="section-actions">
          <button className="ghost-btn" onClick={() => setAddingFolder((v) => !v)}><FolderPlus size={14} /> Folder</button>
          <button className="ghost-btn" onClick={onNewTemplate}><Plus size={14} /> Template</button>
        </div>
      </div>

      {addingFolder && (
        <div className="add-row" style={{ marginBottom: 14 }}>
          <input className="set-input wide" placeholder="Folder name" value={folderName} onChange={(e) => setFolderName(e.target.value)} />
          <button className="btn-small" onClick={() => { if (folderName.trim()) { onCreateFolder(folderName.trim()); setFolderName(""); setAddingFolder(false); } }}>Add</button>
        </div>
      )}

      {grouped.map(({ folder, items }) => (
        <div key={folder.id} className="folder-block">
          <div className="folder-head" onClick={() => setCollapsed((c) => ({ ...c, [folder.id]: !c[folder.id] }))}>
            {collapsed[folder.id] ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            <Folder size={15} />
            {renaming === folder.id ? (
              <input
                className="set-input" style={{ flex: 1 }} value={renameVal} autoFocus
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setRenameVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && renameVal.trim()) { onRenameFolder(folder.id, renameVal.trim()); setRenaming(null); } }}
                onBlur={() => { if (renameVal.trim()) onRenameFolder(folder.id, renameVal.trim()); setRenaming(null); }}
              />
            ) : (
              <span className="folder-name">{folder.name}</span>
            )}
            <span className="folder-count">{items.length}</span>
            <button className="icon-btn subtle" onClick={(e) => { e.stopPropagation(); setRenaming(folder.id); setRenameVal(folder.name); }}><Pencil size={13} /></button>
            <button className="icon-btn subtle" onClick={(e) => { e.stopPropagation(); setConfirmDelete({ type: "folder", id: folder.id, name: folder.name }); }}><Trash2 size={13} /></button>
          </div>
          {!collapsed[folder.id] && (
            <div className="tpl-list nested">
              {items.length === 0 ? <div className="empty small">No templates in this folder.</div> : items.map(renderTemplateCard)}
            </div>
          )}
        </div>
      ))}

      {unfiled.length > 0 && (
        <div className="folder-block">
          <div className="folder-head static"><Folder size={15} /><span className="folder-name">Uncategorized</span></div>
          <div className="tpl-list nested">{unfiled.map(renderTemplateCard)}</div>
        </div>
      )}

      {templates.length === 0 && <div className="empty">No templates yet — create one to get started.</div>}

      {confirmDelete && (
        <div className="sheet-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head"><span>Delete {confirmDelete.type}?</span><button className="icon-btn" onClick={() => setConfirmDelete(null)}><X size={18} /></button></div>
            <p className="sub" style={{ margin: "0 0 16px" }}>
              {confirmDelete.type === "folder"
                ? `"${confirmDelete.name}" will be removed. Its templates move to Uncategorized.`
                : `"${confirmDelete.name}" will be permanently deleted.`}
            </p>
            <button
              className="btn-empty danger"
              onClick={() => {
                if (confirmDelete.type === "folder") onDeleteFolder(confirmDelete.id);
                else onDeleteTemplate(confirmDelete.id);
                setConfirmDelete(null);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template editor
// ---------------------------------------------------------------------------

function TemplateEditor({ template, folders, library, onCreateCustomExercise, onSave, onDelete, onClose, onCreateFolder }) {
  const [name, setName] = useState(template?.name || "New Template");
  const [folderId, setFolderId] = useState(template?.folderId || "");
  const [exercises, setExercises] = useState(template?.exercises || []);
  const [picking, setPicking] = useState(false);
  const [restEditIdx, setRestEditIdx] = useState(null);
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const addExercise = (exId) => { setExercises((ex) => [...ex, { exId, sets: 3, rest: 120 }]); setPicking(false); };
  const removeExercise = (idx) => setExercises((ex) => ex.filter((_, i) => i !== idx));
  const updateExercise = (idx, patch) => setExercises((ex) => ex.map((e, i) => (i === idx ? { ...e, ...patch } : e)));

  const handleSave = () => {
    onSave({
      id: template?.id || uid(),
      name: name.trim() || "Untitled",
      folderId: folderId || null,
      exercises,
    });
  };

  return (
    <div className="sheet-overlay full" onClick={onClose}>
      <div className="sheet tall" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span>{template ? "Edit template" : "New template"}</span>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <input className="set-input wide" style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" />

        <div className="folder-select-row">
          {!newFolderMode ? (
            <>
              <select className="set-input wide" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                <option value="">No folder</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <button className="btn-small" onClick={() => setNewFolderMode(true)}>New folder</button>
            </>
          ) : (
            <>
              <input className="set-input wide" placeholder="Folder name" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} />
              <button className="btn-small" onClick={() => { if (newFolderName.trim()) { const id = onCreateFolder(newFolderName.trim()); setFolderId(id); setNewFolderName(""); setNewFolderMode(false); } }}>Add</button>
            </>
          )}
        </div>

        <div className="section-label" style={{ marginTop: 18, marginBottom: 10, display: "block" }}>Exercises</div>
        {exercises.map((ex, idx) => (
          <div className="editor-ex-row" key={idx}>
            <div className="editor-ex-top">
              <span className="editor-ex-name">{exById(library, ex.exId).name}</span>
              <button className="icon-btn subtle" onClick={() => removeExercise(idx)}><Trash2 size={14} /></button>
            </div>
            <div className="editor-ex-controls">
              <div className="stepper">
                <button onClick={() => updateExercise(idx, { sets: Math.max(1, ex.sets - 1) })}>−</button>
                <span>{ex.sets} sets</span>
                <button onClick={() => updateExercise(idx, { sets: ex.sets + 1 })}>+</button>
              </div>
              <button className="rest-tag" onClick={() => setRestEditIdx(idx)}><Timer size={13} /> {fmtClock(ex.rest || 120)} rest</button>
            </div>
          </div>
        ))}
        <button className="btn-empty" onClick={() => setPicking(true)}><Plus size={16} /> Add exercise</button>

        <div className="editor-footer">
          {template && <button className="btn-empty danger" onClick={() => onDelete(template.id)}><Trash2 size={16} /> Delete template</button>}
          <button className="btn-finish wide" onClick={handleSave}>Save template</button>
        </div>

        {picking && (
          <ExercisePickerSheet
            library={library}
            onPick={(id) => addExercise(id)}
            onClose={() => setPicking(false)}
            onCreateCustom={onCreateCustomExercise}
          />
        )}

        {restEditIdx !== null && (
          <RestPickerSheet
            value={exercises[restEditIdx]?.rest}
            onPick={(v) => updateExercise(restEditIdx, { rest: v })}
            onClose={() => setRestEditIdx(null)}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active session
// ---------------------------------------------------------------------------

function ActiveSession({ session, setSession, onFinish, onDiscard, library, onCreateCustomExercise }) {
  const [elapsed, setElapsed] = useState(0);
  const [rest, setRest] = useState(null); // { total, remaining, exId }
  const [picking, setPicking] = useState(false);
  const [restEditId, setRestEditId] = useState(null);
  const [editingSets, setEditingSets] = useState({});
  const startRef = useRef(new Date(session.startedAt).getTime());

  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!rest) return;
    if (rest.remaining <= 0) { setRest(null); return; }
    const t = setTimeout(() => setRest((r) => r && { ...r, remaining: r.remaining - 1 }), 1000);
    return () => clearTimeout(t);
  }, [rest]);

  const updateExercise = (id, fn) => setSession((s) => ({ ...s, exercises: s.exercises.map((ex) => (ex.id === id ? fn(ex) : ex)) }));

  const addSet = (id) => updateExercise(id, (ex) => ({
    ...ex, sets: [...ex.sets, { id: uid(), weight: ex.sets.at(-1)?.weight ?? "", reps: ex.sets.at(-1)?.reps ?? "", completed: false }],
  }));

  const removeSet = (id, setId) => updateExercise(id, (ex) => ({
    ...ex, sets: ex.sets.length > 1 ? ex.sets.filter((s) => s.id !== setId) : ex.sets,
  }));

  const toggleSet = (id, setId) => {
    const targetEx = session.exercises.find((e) => e.id === id);
    if (!targetEx) return;

    updateExercise(id, (e) => ({
      ...e,
      sets: e.sets.map((s) => {
        if (s.id !== setId) return s;
        const completed = !s.completed;
        if (completed) setRest({ total: e.rest || 120, remaining: e.rest || 120, exId: id });
        return { ...s, completed };
      }),
    }));
  };

  const editSet = (id, setId, field, value) => updateExercise(id, (ex) => ({ ...ex, sets: ex.sets.map((s) => (s.id === setId ? { ...s, [field]: value } : s)) }));
  const removeExercise = (id) => setSession((s) => ({ ...s, exercises: s.exercises.filter((ex) => ex.id !== id) }));
  const setExerciseRest = (id, val) => setSession((s) => ({ ...s, exercises: s.exercises.map((ex) => (ex.id === id ? { ...ex, rest: val } : ex)) }));

  const addExercise = (exId) => {
    setSession((s) => ({ ...s, exercises: [...s.exercises, { id: uid(), exId, rest: 120, sets: [{ id: uid(), weight: "", reps: "", completed: false }] }] }));
    setPicking(false);
  };

  const completedSetCount = session.exercises.reduce((n, ex) => n + ex.sets.filter((s) => s.completed).length, 0);

  return (
    <div className="pad session">
      <div className="session-top">
        <button className="icon-btn" onClick={onDiscard}><X size={20} /></button>
        <div className="session-timer">{fmtClock(elapsed)}</div>
        <button className="btn-finish" onClick={() => onFinish(session)}>Finish</button>
      </div>

      <input className="session-title-input" value={session.name} onChange={(e) => setSession((s) => ({ ...s, name: e.target.value }))} />
      <div className="session-sub">{fmtDateFull(session.startedAt)} · {completedSetCount} sets logged</div>

      {rest && (
        <div className="rest-banner">
          <Timer size={16} />
          <div className="rest-track"><div className="rest-fill" style={{ width: `${(rest.remaining / rest.total) * 100}%` }} /></div>
          <span className="rest-time">{fmtClock(rest.remaining)}</span>
          <button className="rest-skip" onClick={() => setRest(null)}>skip</button>
        </div>
      )}

      {session.exercises.map((ex) => {
        const exInfo = exById(library, ex.exId);
        const editing = !!editingSets[ex.id];
        return (
          <div className="exercise-block" key={ex.id}>
            <div className="exercise-head">
              <div className="exercise-name">{exInfo.name}</div>
              <div className="exercise-head-actions">
                <button className="rest-tag" onClick={() => setRestEditId(ex.id)}><Timer size={13} /> {fmtClock(ex.rest || 120)}</button>
                <button
                  className={`edit-toggle ${editing ? "on" : ""}`}
                  onClick={() => setEditingSets((m) => ({ ...m, [ex.id]: !m[ex.id] }))}
                >
                  {editing ? <><Check size={13} /> Done</> : <><Pencil size={13} /> Edit</>}
                </button>
                <button className="icon-btn subtle" onClick={() => removeExercise(ex.id)}><Trash2 size={16} /></button>
              </div>
            </div>
            <div className="set-grid set-grid-head"><span>Set</span><span>lbs</span><span>Reps</span><span></span><span></span></div>
            <div className="reps-hint">Reps also takes <b>F</b> (to failure) or <b>W</b> (warmup)</div>
            {ex.sets.map((s, si) => {
              const tag = repsTag(s.reps);
              return (
                <div className={`set-grid ${s.completed ? "set-done" : ""}`} key={s.id}>
                  {tag ? <span className={`set-badge ${tag === "F" ? "failure" : "warmup"}`}>{tag}</span> : <span className="set-num">{si + 1}</span>}
                  <input className="set-input" inputMode="decimal" placeholder="0" value={s.weight} onChange={(e) => editSet(ex.id, s.id, "weight", e.target.value)} />
                  <input
                    className={`set-input ${tag ? (tag === "F" ? "reps-failure" : "reps-warmup") : ""}`}
                    inputMode="text" placeholder="0 / F / W" value={s.reps}
                    onChange={(e) => editSet(ex.id, s.id, "reps", normalizeReps(e.target.value))}
                  />
                  <button className={`check-btn ${s.completed ? "on" : ""}`} onClick={() => toggleSet(ex.id, s.id)}><Check size={16} strokeWidth={3} /></button>
                  {editing ? (
                    <button className="del-set-btn" onClick={() => removeSet(ex.id, s.id)} aria-label="Delete set"><X size={14} /></button>
                  ) : <span />}
                </div>
              );
            })}
            {editing && <button className="add-set-btn" onClick={() => addSet(ex.id)}>+ Add Set</button>}
          </div>
        );
      })}

      <button className="btn-empty" onClick={() => setPicking(true)}><Plus size={18} /> Add exercise</button>

      {picking && (
        <ExercisePickerSheet
          library={library}
          onPick={(id) => addExercise(id)}
          onClose={() => setPicking(false)}
          onCreateCustom={onCreateCustomExercise}
        />
      )}

      {restEditId !== null && (
        <RestPickerSheet
          value={session.exercises.find(e => e.id === restEditId)?.rest}
          onPick={(v) => setExerciseRest(restEditId, v)}
          onClose={() => setRestEditId(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History tab
// ---------------------------------------------------------------------------

function HistoryTab({ history, library, onDelete }) {
  if (history.length === 0) {
    return <div className="pad"><h1 className="h1">History</h1><div className="empty">No sessions logged yet. Finish a workout to see it here.</div></div>;
  }
  return (
    <div className="pad">
      <h1 className="h1">History</h1>
      <div className="hist-list">
        {history.map((w) => {
          const totalSets = w.exercises.reduce((n, ex) => n + ex.sets.length, 0);
          const totalVolume = w.exercises.reduce((n, ex) => n + ex.sets.reduce((v, s) => v + (Number(s.weight) || 0) * (parseInt(s.reps, 10) || 0), 0), 0);
          return (
            <div className="hist-card" key={w.id}>
              <div className="hist-card-top">
                <div><div className="hist-name">{w.name}</div><div className="hist-date">{fmtDateFull(w.startedAt)}</div></div>
                <button className="icon-btn subtle" onClick={() => onDelete(w.id)}><Trash2 size={16} /></button>
              </div>
              <div className="hist-stats"><span>{w.exercises.length} exercises</span><span>·</span><span>{totalSets} sets</span><span>·</span><span>{totalVolume.toLocaleString()} lbs volume</span></div>
              <div className="hist-ex-list">
                {w.exercises.map((ex, i) => (
                  <div className="hist-ex-row" key={i}><span className="hist-ex-name">{exById(library, ex.exId).name}</span><span className="hist-ex-sets">{ex.sets.map((s) => `${s.weight}×${s.reps}`).join(", ")}</span></div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress tab
// ---------------------------------------------------------------------------

function ProgressTab({ history, library, bodyweight, setBodyweight }) {
  const [weightInput, setWeightInput] = useState("");
  const [selectedEx, setSelectedEx] = useState(null);

  const exercisesLogged = useMemo(() => {
    const ids = new Set();
    history.forEach((w) => w.exercises.forEach((ex) => ids.add(ex.exId)));
    return library.filter((e) => ids.has(e.id));
  }, [history, library]);

  // Prevent crashing if the selected exercise gets deleted from history logs
  useEffect(() => {
    if (exercisesLogged.length > 0) {
      const stillExists = exercisesLogged.some(e => e.id === selectedEx);
      if (!selectedEx || !stillExists) {
        setSelectedEx(exercisesLogged[0].id);
      }
    } else {
      setSelectedEx(null);
    }
  }, [exercisesLogged, selectedEx]);

  const bwData = useMemo(() => [...bodyweight].sort((a, b) => new Date(a.date) - new Date(b.date)).map((b) => ({ date: b.date, label: fmtDate(b.date), weight: b.weight })), [bodyweight]);

  const strengthData = useMemo(() => {
    if (!selectedEx) return [];
    const rows = [];
    [...history].sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt)).forEach((w) => {
      const ex = w.exercises.find((e) => e.exId === selectedEx);
      if (!ex || ex.sets.length === 0) return;
      let best = 0;
      ex.sets.forEach((s) => { 
        const r = parseInt(s.reps, 10) || 0; // Better fallback logic for "10F" logs
        const e1 = est1RM(Number(s.weight) || 0, r); 
        if (e1 > best) best = e1; 
      });
      rows.push({ date: w.startedAt, label: fmtDate(w.startedAt), est1rm: best });
    });
    return rows;
  }, [history, selectedEx]);

  const addWeight = () => {
    const v = parseFloat(weightInput);
    if (!v || v <= 0) return;
    const today = new Date().toISOString().slice(0, 10);
    setBodyweight((bw) => [...bw.filter((b) => b.date !== today), { date: today, weight: v }]);
    setWeightInput("");
  };

  const latestBw = bwData.at(-1), firstBw = bwData[0];
  const bwDelta = latestBw && firstBw ? Math.round((latestBw.weight - firstBw.weight) * 10) / 10 : null;
  const latestStrength = strengthData.at(-1), firstStrength = strengthData[0];
  const strengthDelta = latestStrength && firstStrength ? Math.round((latestStrength.est1rm - firstStrength.est1rm) * 10) / 10 : null;

  return (
    <div className="pad">
      <h1 className="h1">Progress</h1>
      <p className="sub">Body weight and estimated strength over time.</p>

      <div className="card">
        <div className="card-head"><Scale size={16} color="var(--accent2)" /><span>Body weight</span>{bwDelta !== null && <span className={`delta ${bwDelta <= 0 ? "down" : "up"}`}>{bwDelta > 0 ? "+" : ""}{bwDelta} lb</span>}</div>
        <div className="add-row">
          <input className="set-input wide" inputMode="decimal" placeholder="Today's weight (lb)" value={weightInput} onChange={(e) => setWeightInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addWeight()} />
          <button className="btn-small" onClick={addWeight}>Log</button>
        </div>
        {bwData.length > 0 ? (
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={bwData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="var(--gridline)" vertical={false} />
                <XAxis dataKey="label" stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} domain={["dataMin - 2", "dataMax + 2"]} />
                <Tooltip content={<ChartTip unit="lb" />} />
                <Line type="monotone" dataKey="weight" stroke="var(--accent2)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--accent2)" }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : <div className="empty small">Log your weight to start the trend line.</div>}
      </div>

      <div className="card">
        <div className="card-head"><TrendingUp size={16} color="var(--accent)" /><span>Strength by lift</span>{strengthDelta !== null && <span className={`delta ${strengthDelta >= 0 ? "up" : "down"}`}>{strengthDelta > 0 ? "+" : ""}{strengthDelta} lb est. 1RM</span>}</div>
        {exercisesLogged.length === 0 ? <div className="empty small">Finish a logged workout to see strength trends.</div> : (
          <>
            <div className="chip-row">
              {exercisesLogged.map((e) => <button key={e.id} className={`chip ${selectedEx === e.id ? "chip-on" : ""}`} onClick={() => setSelectedEx(e.id)}>{e.name}</button>)}
            </div>
            {strengthData.length > 1 ? (
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={strengthData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke="var(--gridline)" vertical={false} />
                    <XAxis dataKey="label" stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} domain={["dataMin - 5", "dataMax + 5"]} />
                    <Tooltip content={<ChartTip unit="lb est. 1RM" />} />
                    <Line type="monotone" dataKey="est1rm" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--accent)" }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : <div className="empty small">Log this lift across a couple more sessions to see a trend.</div>}
          </>
        )}
      </div>
    </div>
  );
}

function ChartTip({ active, payload, label, unit }) {
  if (!active || !payload || !payload.length) return null;
  return <div className="chart-tip"><div className="chart-tip-label">{label}</div><div className="chart-tip-val">{payload[0].value} {unit}</div></div>;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const CSS = `
:root {
  --bg: #15171b; --surface: #1d2025; --surface-2: #23272d; --border: #2c3138; --gridline: #262a30;
  --text: #f2f0ec; --muted: #8a8f98; --accent: #ff7a45; --accent-dim: #4a3126; --accent2: #35c9b0;
}
* { box-sizing: border-box; }
.app { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: var(--bg); color: var(--text); width: 100%; max-width: 460px; margin: 0 auto; min-height: 640px; display: flex; flex-direction: column; border-radius: 20px; overflow: hidden; border: 1px solid var(--border); position: relative; }
.screen { flex: 1; overflow-y: auto; }
.account-bar { display: flex; align-items: center; justify-content: space-between; padding: 8px 18px; border-bottom: 1px solid var(--border); font-size: 11px; color: var(--muted); }
.account-signout { background: none; border: none; color: var(--accent); font-size: 11px; font-weight: 600; cursor: pointer; }
.auth-loading { display: flex; align-items: center; justify-content: center; height: 300px; color: var(--muted); font-size: 13px; }
.auth-screen { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; padding: 60px 24px; }
.auth-sent { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px; font-size: 13px; margin-top: 8px; }
.auth-error { color: #ef8b7c; font-size: 12px; margin-top: -4px; }
.pad { padding: 20px 18px 28px; }
.h1 { font-size: 26px; font-weight: 700; margin: 4px 0 2px; letter-spacing: -0.02em; }
.sub { color: var(--muted); font-size: 13px; margin: 0 0 18px; }
.section-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
.section-label-row { display: flex; align-items: center; justify-content: space-between; margin: 22px 0 12px; }
.section-actions { display: flex; gap: 8px; }
.ghost-btn { display: flex; align-items: center; gap: 5px; background: var(--surface); border: 1px solid var(--border); color: var(--text); font-size: 12px; font-weight: 600; padding: 6px 10px; border-radius: 8px; cursor: pointer; }

.btn-empty { width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; background: var(--surface); border: 1px dashed var(--border); color: var(--text); padding: 14px; border-radius: 12px; font-size: 14px; font-weight: 600; cursor: pointer; margin-bottom: 6px; }
.btn-empty.danger { color: #ef8b7c; border-color: #4a2b26; }

.tpl-list { display: flex; flex-direction: column; gap: 10px; }
.tpl-list.nested { margin: 8px 0 4px; }
.tpl-card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
.tpl-card-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 16px; cursor: pointer; }
.tpl-name { font-weight: 700; font-size: 16px; }
.tpl-meta { color: var(--muted); font-size: 12px; margin-top: 4px; line-height: 1.5; }
.tpl-last { color: var(--accent2); font-size: 11px; margin-top: 6px; }
.tpl-card-actions { display: flex; border-top: 1px solid var(--border); }
.tpl-action { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; background: none; border: none; color: var(--muted); font-size: 12px; font-weight: 600; padding: 9px 0; cursor: pointer; }
.tpl-action.danger { color: #ef8b7c; }
.tpl-action:first-child { border-right: 1px solid var(--border); }
.tpl-hint { font-size: 10px; color: var(--muted); opacity: 0.55; padding: 0 16px 10px; margin-top: -4px; }
.tpl-card.menu-open { border-color: var(--accent-dim); }
.tpl-card-top { user-select: none; -webkit-user-select: none; touch-action: manipulation; }

.folder-block { margin-bottom: 14px; }
.folder-head { display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 6px 2px; color: var(--text); }
.folder-head.static { cursor: default; }
.folder-name { font-weight: 700; font-size: 13px; }
.folder-count { color: var(--muted); font-size: 11px; margin-left: 2px; }
.folder-head .icon-btn.subtle { margin-left: auto; }

.tabbar { display: flex; border-top: 1px solid var(--border); background: var(--surface); }
.tabbtn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 10px 0 12px; background: none; border: none; color: var(--muted); font-size: 11px; cursor: pointer; }
.tabbtn.active { color: var(--accent); }

.session-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.session-timer { font-family: 'JetBrains Mono', monospace; font-size: 15px; color: var(--muted); font-variant-numeric: tabular-nums; }
.icon-btn { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; color: var(--text); cursor: pointer; }
.icon-btn.subtle { background: none; border: none; color: var(--muted); width: auto; height: auto; padding: 4px; }
.btn-finish { background: var(--accent2); color: #0c1614; border: none; font-weight: 700; font-size: 14px; padding: 9px 18px; border-radius: 10px; cursor: pointer; }
.btn-finish.wide { width: 100%; padding: 13px; margin-top: 10px; }

.session-title-input { background: none; border: none; color: var(--text); font-size: 24px; font-weight: 700; width: 100%; padding: 0; letter-spacing: -0.02em; }
.session-title-input:focus { outline: none; }
.session-sub { color: var(--muted); font-size: 12px; margin: 2px 0 14px; }

.rest-banner { display: flex; align-items: center; gap: 8px; background: var(--surface); border: 1px solid var(--accent-dim); border-radius: 12px; padding: 8px 12px; margin-bottom: 16px; color: var(--accent); }
.rest-track { flex: 1; height: 4px; background: var(--border); border-radius: 4px; overflow: hidden; }
.rest-fill { height: 100%; background: var(--accent); transition: width 1s linear; }
.rest-time { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-variant-numeric: tabular-nums; }
.rest-skip { background: none; border: none; color: var(--muted); font-size: 11px; cursor: pointer; text-decoration: underline; }

.exercise-block { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 14px; margin-bottom: 12px; }
.exercise-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.exercise-head-actions { display: flex; align-items: center; gap: 8px; }
.exercise-name { font-weight: 700; font-size: 15px; color: var(--accent2); }
.rest-tag { display: flex; align-items: center; gap: 4px; background: var(--surface-2); border: 1px solid var(--border); color: var(--muted); font-size: 11px; padding: 5px 9px; border-radius: 20px; cursor: pointer; font-family: 'JetBrains Mono', monospace; }
.edit-toggle { display: flex; align-items: center; gap: 4px; background: var(--surface-2); border: 1px solid var(--border); color: var(--muted); font-size: 11px; font-weight: 600; padding: 5px 9px; border-radius: 20px; cursor: pointer; }
.edit-toggle.on { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }
.custom-ex-form { display: flex; flex-direction: column; gap: 8px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 10px; margin-bottom: 6px; }

.set-grid { display: grid; grid-template-columns: 28px 1fr 1fr 38px 26px; gap: 6px; align-items: center; margin-bottom: 6px; }
.set-grid-head { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 8px; }
.set-num { color: var(--muted); font-size: 13px; text-align: center; font-family: 'JetBrains Mono', monospace; }
.reps-hint { color: var(--muted); font-size: 11px; margin: -2px 0 8px; }
.reps-hint b { color: var(--text); }
.set-badge { width: 26px; height: 22px; margin: 0 auto; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; font-family: 'JetBrains Mono', monospace; }
.set-badge.warmup { background: rgba(255, 184, 92, 0.16); color: #ffb85c; }
.set-badge.failure { background: rgba(239, 139, 124, 0.16); color: #ef8b7c; }
.set-input.reps-warmup { color: #ffb85c; border-color: rgba(255, 184, 92, 0.4); font-weight: 700; }
.set-input.reps-failure { color: #ef8b7c; border-color: rgba(239, 139, 124, 0.4); font-weight: 700; }
.set-input { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; color: var(--text); padding: 9px 6px; text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 14px; width: 100%; font-variant-numeric: tabular-nums; }
.set-input.wide { text-align: left; padding: 10px 12px; }
.set-input:focus { outline: none; border-color: var(--accent); }
.check-btn { width: 34px; height: 34px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface-2); color: var(--muted); display: flex; align-items: center; justify-content: center; cursor: pointer; margin: 0 auto; }
.check-btn.on { background: var(--accent2); border-color: var(--accent2); color: #0c1614; }
.del-set-btn { width: 26px; height: 26px; border-radius: 8px; border: none; background: none; color: var(--muted); display: flex; align-items: center; justify-content: center; cursor: pointer; margin: 0 auto; }
.del-set-btn:hover { color: #ef8b7c; }
.set-done .set-input { opacity: 0.75; }
.add-set-btn { width: 100%; background: none; border: none; color: var(--accent); font-size: 13px; font-weight: 600; padding: 8px 0 2px; cursor: pointer; text-align: left; }

.sheet-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: flex-end; z-index: 20; max-width: 460px; margin: 0 auto; }
.sheet-overlay.full { z-index: 30; }
.sheet { background: var(--surface); width: 100%; max-height: 70%; border-radius: 18px 18px 0 0; padding: 16px; overflow-y: auto; }
.sheet.tall { max-height: 88%; }
.sheet-head { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 16px; margin-bottom: 10px; }
.sheet-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 4px; border-bottom: 1px solid var(--border); cursor: pointer; }
.sheet-item-name { font-size: 14px; font-weight: 600; }
.sheet-item-muscle { font-size: 11px; color: var(--muted); margin-top: 2px; }

.folder-select-row { display: flex; gap: 8px; }
select.set-input { -webkit-appearance: none; appearance: none; }

.editor-ex-row { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; }
.editor-ex-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.editor-ex-name { font-weight: 600; font-size: 13px; }
.editor-ex-controls { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.stepper { display: flex; align-items: center; gap: 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 4px 10px; font-size: 12px; font-family: 'JetBrains Mono', monospace; }
.stepper button { background: none; border: none; color: var(--accent); font-size: 16px; width: 20px; cursor: pointer; }
.editor-footer { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }

.rest-preset-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.rest-preset { background: var(--surface-2); border: 1px solid var(--border); color: var(--text); font-family: 'JetBrains Mono', monospace; font-size: 14px; padding: 12px 0; border-radius: 10px; cursor: pointer; }
.rest-preset.on { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }

.hist-list { display: flex; flex-direction: column; gap: 12px; }
.hist-card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 14px 16px; }
.hist-card-top { display: flex; justify-content: space-between; align-items: flex-start; }
.hist-name { font-weight: 700; font-size: 15px; }
.hist-date { color: var(--muted); font-size: 12px; margin-top: 2px; }
.hist-stats { display: flex; gap: 6px; color: var(--muted); font-size: 12px; margin: 8px 0 10px; }
.hist-ex-list { border-top: 1px solid var(--border); padding-top: 8px; display: flex; flex-direction: column; gap: 5px; }
.hist-ex-row { display: flex; justify-content: space-between; font-size: 12px; gap: 10px; }
.hist-ex-name { color: var(--text); font-weight: 600; }
.hist-ex-sets { color: var(--muted); font-family: 'JetBrains Mono', monospace; text-align: right; }

.empty { color: var(--muted); font-size: 13px; text-align: center; padding: 40px 10px; }
.empty.small { padding: 18px 6px; }

.card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 14px 16px; margin-bottom: 14px; }
.card-head { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; margin-bottom: 12px; }
.delta { margin-left: auto; font-size: 12px; font-family: 'JetBrains Mono', monospace; padding: 2px 8px; border-radius: 6px; }
.delta.up { color: var(--accent2); background: rgba(53,201,176,0.12); }
.delta.down { color: #ef8b7c; background: rgba(239,139,124,0.1); }

.add-row { display: flex; gap: 8px; margin-bottom: 4px; }
.btn-small { background: var(--accent); border: none; color: #241206; font-weight: 700; font-size: 13px; padding: 0 16px; border-radius: 8px; cursor: pointer; white-space: nowrap; }

.chart-wrap { margin-top: 10px; }
.chart-tip { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; font-size: 12px; }
.chart-tip-label { color: var(--muted); font-size: 11px; }
.chart-tip-val { font-family: 'JetBrains Mono', monospace; font-weight: 700; color: var(--text); }

.chip-row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
.chip { background: var(--surface-2); border: 1px solid var(--border); color: var(--muted); font-size: 11px; padding: 6px 10px; border-radius: 20px; cursor: pointer; }
.chip-on { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }
`;