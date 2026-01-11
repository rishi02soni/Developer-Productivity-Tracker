import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, onSnapshot, query, doc, updateDoc, deleteDoc, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Global State
let dbMode = 'LOCAL'; 
let user = null;
let tasks = [];
let activeId = null;
let timer = null;
let charts = {};
let sessionStart = Date.now();
let isAuthNextStep = false;
let authMode = 'SIGN_IN';

// 1. App Initialization
const initSystem = async () => {
    let firebaseApp, auth, db;
    const configRaw = typeof __firebase_config !== 'undefined' ? __firebase_config : null;
    
    if (configRaw) {
        try {
            const firebaseConfig = JSON.parse(configRaw);
            firebaseApp = initializeApp(firebaseConfig);
            auth = getAuth(firebaseApp);
            db = getFirestore(firebaseApp);
            dbMode = 'CLOUD';
            document.getElementById('statusText').textContent = 'AZURE_SYNC_OK';
        } catch (e) {
            enableLocalMode();
        }
    } else {
        enableLocalMode();
    }

    if (dbMode === 'CLOUD') {
        onAuthStateChanged(auth, (u) => {
            if (u) {
                user = u;
                document.getElementById('authOverlay').classList.add('hidden');
                document.getElementById('userAlias').textContent = u.uid.substring(0,8);
                document.getElementById('welcomeName').textContent = "Engineer-" + u.uid.substring(0,4);
                startDataSync(db);
            } else {
                document.getElementById('authOverlay').classList.remove('hidden');
            }
        });
    } else {
        document.getElementById('authOverlay').classList.remove('hidden');
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden && activeId) {
            toggleTimer(activeId);
            showToast("Focus Guard: Auto-paused coding timer.", "info");
        }
    });
};

const enableLocalMode = () => {
    dbMode = 'LOCAL';
    document.getElementById('statusIndicator').classList.replace('bg-green-400', 'bg-blue-400');
    document.getElementById('statusText').textContent = 'LOCAL_STORAGE_MODE';
};

// 2. Auth Actions
window.toggleAuthMode = () => {
    authMode = authMode === 'SIGN_IN' ? 'SIGN_UP' : 'SIGN_IN';
    document.getElementById('authTitle').textContent = authMode === 'SIGN_IN' ? 'Sign in' : 'Create account';
    document.getElementById('authSubtitle').textContent = authMode === 'SIGN_IN' ? 'Use your engineering account' : 'Register for access';
    document.getElementById('loginBtnText').textContent = 'Next';
    document.getElementById('passwordArea').classList.add('hidden');
    isAuthNextStep = false;
};

window.handleLoginStep = async () => {
    const email = document.getElementById('loginEmail').value;
    if (!email || !email.includes('@')) {
        showToast("Please enter a valid work email.", "error");
        return;
    }

    if (!isAuthNextStep) {
        document.getElementById('passwordArea').classList.remove('hidden');
        document.getElementById('loginBtnText').textContent = authMode === 'SIGN_IN' ? 'Sign in' : 'Register';
        isAuthNextStep = true;
        return;
    }

    const loader = document.getElementById('loginLoader');
    const btnText = document.getElementById('loginBtnText');
    loader.classList.remove('hidden');
    btnText.classList.add('opacity-0');

    setTimeout(async () => {
        if (dbMode === 'CLOUD') {
            try {
                await signInAnonymously(getAuth());
            } catch (e) {
                showToast("Cloud Auth Failed.", "error");
                loader.classList.add('hidden');
                btnText.classList.remove('opacity-0');
            }
        } else {
            handleLocalAuth(email);
        }
    }, 1000);
};

const handleLocalAuth = (email) => {
    user = { uid: 'local-' + btoa(email).substring(0,8), email };
    document.getElementById('authOverlay').classList.add('hidden');
    document.getElementById('userAlias').textContent = user.uid.split('-')[1];
    document.getElementById('welcomeName').textContent = email.split('@')[0];
    logActivity("AUTH_SUCCESS", `Logged in as ${email}`);
    loadLocalData();
};

window.logout = () => {
    if (dbMode === 'CLOUD') signOut(getAuth());
    location.reload();
};

// 3. Data Sync
const startDataSync = (db) => {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app';
    const q = query(collection(db, 'artifacts', appId, 'users', user.uid, 'tasks'));
    onSnapshot(q, (snap) => {
        tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        refreshUI();
    });
};

const loadLocalData = () => {
    const saved = localStorage.getItem('dev_tasks_v2');
    tasks = saved ? JSON.parse(saved) : [];
    refreshUI();
};

const saveToDb = async (payload, id = null) => {
    if (dbMode === 'CLOUD') {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app';
        const firestore = getFirestore();
        if (id) {
            await updateDoc(doc(firestore, 'artifacts', appId, 'users', user.uid, 'tasks', id), payload);
        } else {
            await addDoc(collection(firestore, 'artifacts', appId, 'users', user.uid, 'tasks'), { 
                ...payload, status: 'Proposed', timeSpent: 0, createdAt: Timestamp.now() 
            });
        }
    } else {
        if (id) {
            const idx = tasks.findIndex(t => t.id === id);
            tasks[idx] = { ...tasks[idx], ...payload };
        } else {
            tasks.push({ 
                id: 'task-' + Date.now(), 
                ...payload, 
                status: 'Proposed', 
                timeSpent: 0, 
                createdAt: new Date().toISOString() 
            });
        }
        localStorage.setItem('dev_tasks_v2', JSON.stringify(tasks));
        refreshUI();
    }
};

// 4. UI Rendering
window.switchTab = (tab) => {
    ['dashboard', 'board', 'activity', 'analytics'].forEach(t => {
        document.getElementById(`view-${t}`).classList.add('hidden');
        document.getElementById(`tab-${t}`).classList.remove('active');
    });
    document.getElementById(`view-${tab}`).classList.remove('hidden');
    document.getElementById(`tab-${tab}`).classList.add('active');
    renderCharts();
};

const refreshUI = () => {
    renderKanban();
    updateStats();
    renderCharts();
};

const updateStats = () => {
    const completed = tasks.filter(t => t.status === 'Completed').length;
    const totalSecs = tasks.reduce((a, b) => a + (b.timeSpent || 0), 0);
    const hrs = totalSecs / 3600;
    
    document.getElementById('scoreVal').textContent = Math.round((completed * 45) + (hrs * 12));
    document.getElementById('focusVal').textContent = hrs.toFixed(1);
    document.getElementById('resolveVal').textContent = completed;
    
    const p = Math.min((hrs / 8) * 100, 100);
    document.getElementById('goalBar').style.width = p + "%";
    document.getElementById('goalPercent').textContent = Math.round(p) + "%";
};

// 5. Kanban Engine
window.allowDrop = (e) => e.preventDefault();
window.drag = (e, id) => e.dataTransfer.setData("text", id);
window.drop = async (e, status) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text");
    const task = tasks.find(t => t.id === id);
    if (task && task.status !== status) {
        if (activeId === id && status !== 'In-Progress') toggleTimer(id);
        await saveToDb({ status, lastMoved: new Date().toISOString() }, id);
        logActivity("BOARD_MOVE", `Item moved to ${status}`);
    }
};

const renderKanban = () => {
    ['Proposed', 'In-Progress', 'Resolved', 'Completed'].forEach(status => {
        const col = document.getElementById(`col-${status}`);
        const count = document.getElementById(`count-${status}`);
        const filtered = tasks.filter(t => t.status === status);
        
        count.textContent = filtered.length;
        col.innerHTML = filtered.map(t => `
            <div draggable="true" ondragstart="drag(event, '${t.id}')" class="ms-card p-4 rounded-sm cursor-grab active:cursor-grabbing hover:border-msBlue transition-all group relative">
                <div class="flex justify-between items-start mb-2">
                    <span class="text-[9px] font-mono text-gray-400">#${t.id.slice(-4)}</span>
                    <span class="text-[9px] px-2 py-0.5 rounded font-bold bg-blue-100 text-blue-700">${t.priority}</span>
                </div>
                <h4 class="text-xs font-semibold mb-1 truncate">${t.title}</h4>
                <div class="flex justify-between items-center border-t dark:border-msBorderDark pt-3">
                    <span class="text-[10px] font-mono ${activeId === t.id ? 'text-msBlue animate-pulse' : 'text-gray-400'}">${formatTime(t.timeSpent || 0)}</span>
                    <button onclick="toggleTimer('${t.id}')" class="w-6 h-6 flex items-center justify-center rounded-full bg-gray-100 dark:bg-msBgDark hover:bg-msBlue hover:text-white transition-all">
                        <i class="fas ${activeId === t.id ? 'fa-pause' : 'fa-play'} text-[8px]"></i>
                    </button>
                </div>
            </div>
        `).join('');
    });
};

// 6. Timer
window.toggleTimer = (id) => {
    if (activeId === id) {
        clearInterval(timer);
        activeId = null;
    } else {
        if (activeId) toggleTimer(activeId);
        activeId = id;
        saveToDb({ status: 'In-Progress' }, id);
        timer = setInterval(async () => {
            const task = tasks.find(t => t.id === id);
            if (task) {
                task.timeSpent = (task.timeSpent || 0) + 1;
                if (dbMode === 'LOCAL') localStorage.setItem('dev_tasks_v2', JSON.stringify(tasks));
            }
            refreshUI();
        }, 1000);
    }
    refreshUI();
};

// 7. Charts
const renderCharts = () => {
    const isDark = document.documentElement.classList.contains('dark');
    const color = isDark ? '#edebe9' : '#323130';

    const velCtx = document.getElementById('velocityChart');
    if (velCtx) {
        if (charts.vel) charts.vel.destroy();
        charts.vel = new Chart(velCtx, {
            type: 'line',
            data: { labels: ['S', 'M', 'T', 'W', 'T', 'F', 'S'], datasets: [{ label: 'Focus', data: [1.2, 3.5, 2.8, 5.1, 3.9, 6.2, 1.5], borderColor: '#0078d4', tension: 0.4 }] },
            options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    }
};

// Utility
window.showToast = (msg, type) => {
    const t = document.createElement('div');
    t.className = `bg-gray-900 text-white px-5 py-3 rounded-sm shadow-2xl text-[11px] font-bold border-l-4 ${type === 'success' ? 'border-msSuccess' : 'border-msBlue'} animate-view`;
    t.innerHTML = msg;
    document.getElementById('toastContainer').appendChild(t);
    setTimeout(() => t.remove(), 4000);
};

window.logActivity = (type, msg) => {
    const feed = document.getElementById('activityFeedList');
    if (!feed) return;
    const item = document.createElement('div');
    item.className = "p-4 hover:bg-gray-50 dark:hover:bg-msBgDark transition-all";
    item.innerHTML = `<span class="text-[9px] font-black text-msBlue uppercase">${type}</span><p class="text-xs">${msg}</p>`;
    feed.prepend(item);
};

const formatTime = (s) => {
    const h = Math.floor(s/3600);
    const m = Math.floor((s%3600)/60);
    const r = s%60;
    return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${r.toString().padStart(2,'0')}`;
};

// Globals for Inline HTML calls
window.closeModal = () => document.getElementById('taskModal').classList.add('hidden');
window.openModal = () => document.getElementById('taskModal').classList.remove('hidden');
window.toggleTheme = () => { document.documentElement.classList.toggle('dark'); renderCharts(); };

window.onload = initSystem;