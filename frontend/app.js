// app.js - Frontend Logic for Intelligent Data Dictionary & Analytics Agent

const BACKEND_URL = "http://127.0.0.1:8000";

// DOM Elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const uploadCard = document.getElementById('uploadCard');
const loadingState = document.getElementById('loadingState');
const dashboardWorkspace = document.getElementById('dashboardWorkspace');
const tableSearch = document.getElementById('tableSearch');
const dictionaryBody = document.getElementById('dictionaryBody');

// State Variables
let currentFileId = null;
let activeDataset = null;
let activeChartInstance = null;
let currentChartsData = null;

// Loading Messages simulation
const loadingSteps = [
    { progress: 20, title: "Ingesting dataset streams...", sub: "Pandas API is checking file structures and data encodings." },
    { progress: 45, title: "Calculating profiling statistics...", sub: "Aggregating row counts, duplicates, missing cells, and outliers." },
    { progress: 70, title: "Inferring semantic columns...", sub: "Validating Emails, Currencies, Category ratios, and Primary Keys." },
    { progress: 90, title: "Generating Llama-3.1 AI analytics...", sub: "Connecting to Groq API to write human-readable business descriptions." }
];

// Helper to format AI descriptions or recommendations that might be nested objects
function formatInsight(val) {
    if (typeof val === 'object' && val !== null) {
        return Object.entries(val)
            .map(([k, v]) => `<strong>${k.charAt(0).toUpperCase() + k.slice(1)}:</strong> ${formatInsight(v)}`)
            .join('<br>');
    }
    return String(val);
}

// Initialize Drag & Drop Events
fileInput.addEventListener('change', (e) => {
    if (fileInput.files.length > 0) {
        handleUpload(fileInput.files);
    }
});

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('highlight');
});

dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.classList.remove('highlight');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('highlight');
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
        handleUpload(files);
    }
});

// Trigger uploading & profiling
async function handleUpload(files) {
    if (!files || files.length === 0) return;
    
    let valid = true;
    for(let i=0; i<files.length; i++) {
        if (files[i].size > 200 * 1024 * 1024) { // 200MB limit
            alert(`File ${files[i].name} exceeds 200MB limit.`);
            valid = false;
        }
    }
    if (!valid) return;

    uploadCard.style.display = 'none';
    loadingState.style.display = 'flex';
    
    // Simulate active loading progression
    let stepIdx = 0;
    const progressFill = document.getElementById('progressBar');
    const loadTitle = document.getElementById('loaderTitle');
    const loadSub = document.getElementById('loaderSubtitle');
    
    const interval = setInterval(() => {
        if (stepIdx < loadingSteps.length) {
            const step = loadingSteps[stepIdx];
            progressFill.style.width = `${step.progress}%`;
            loadTitle.innerText = step.title;
            loadSub.innerText = step.sub;
            stepIdx++;
        }
    }, 1500);

    try {
        const context = document.getElementById('datasetContext').value.trim();
        const formData = new FormData();
        
        for(let i=0; i<files.length; i++){
            formData.append('files', files[i]);
        }
        formData.append('dataset_context', context);

        const response = await fetch(`${BACKEND_URL}/api/analyze`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || "Server analysis error");
        }

        const data = await response.json();
        
        clearInterval(interval);
        progressFill.style.width = "100%";
        
        setTimeout(() => {
            renderDashboard(data.file_id, data.profile, data.is_multi, data.erd_mapping);
        }, 500);

    } catch (err) {
        clearInterval(interval);
        alert(`Analysis Failed: ${err.message}`);
        loadingState.style.display = 'none';
        uploadCard.style.display = 'block';
    }
}

// Render Dashboard Workspace
function renderDashboard(fileId, profile, isMulti = false, erdMapping = null) {
    currentFileId = fileId;
    activeDataset = profile;
    currentChartsData = profile.charts || null;
    
    loadingState.style.display = 'none';
    dashboardWorkspace.style.display = 'block';
    
    // Populate counts
    document.getElementById('totalRows').innerText = profile.total_rows.toLocaleString();
    document.getElementById('totalCols').innerText = profile.total_cols.toLocaleString();
    document.getElementById('duplicateRows').innerText = profile.duplicate_rows.toLocaleString();
    
    // Draw Health gauge circle
    document.getElementById('healthScore').innerText = `${profile.health_score}%`;
    const healthCircle = document.getElementById('healthCircle');
    const radius = healthCircle.r.baseVal.value;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (profile.health_score / 100) * circumference;
    healthCircle.style.strokeDasharray = `${circumference} ${circumference}`;
    healthCircle.style.strokeDashoffset = offset;
    
    // Set health quality descriptions based on scores
    const healthDesc = document.getElementById('healthDescription');
    if (profile.health_score >= 90) {
        healthDesc.innerText = "Excellent data quality with optimal structural consistency.";
        healthDesc.style.color = "#34D399";
    } else if (profile.health_score >= 70) {
        healthDesc.innerText = "Fair quality. Some null records or minor duplicates detected.";
        healthDesc.style.color = "#FBBF24";
    } else {
        healthDesc.innerText = "Critical quality issues flagged. Action required to clean data.";
        healthDesc.style.color = "#F43F5E";
    }
    
    // Populate dictionary rows
    renderTableRows(profile.columns);

    // Initialize Interactive Charts
    if (currentChartsData && Object.keys(currentChartsData).length > 0) {
        document.getElementById('chartCard').style.display = 'block';
        setupChartTabs();
        // Load first available chart by default
        if (currentChartsData.categorical_1) {
            switchChartTab('tabCat1');
        } else if (currentChartsData.categorical_2) {
            switchChartTab('tabCat2');
        } else if (currentChartsData.temporal) {
            switchChartTab('tabTemporal');
        }
    } else {
        document.getElementById('chartCard').style.display = 'none';
    }
    
    // Initialize DDL scripts
    if (profile.sql_ddl && Object.keys(profile.sql_ddl).length > 0) {
        document.getElementById('sqlDdlCard').style.display = 'block';
        setupDdlTabs(profile.sql_ddl);
    } else {
        document.getElementById('sqlDdlCard').style.display = 'none';
    }
    
    // Show Chat Interface
    document.getElementById('chatCard').style.display = 'flex';
    
    // ERD Visualizer
    if (isMulti && erdMapping) {
        document.getElementById('erdCard').style.display = 'block';
        renderMermaidErd(erdMapping);
    } else {
        document.getElementById('erdCard').style.display = 'none';
    }
}

async function renderMermaidErd(mapping) {
    const container = document.getElementById('mermaidErd');
    
    let mermaidText = "erDiagram\n";
    
    mapping.nodes.forEach(node => {
        // Just defining the node
        mermaidText += `    ${node} {\n        string columns\n    }\n`;
    });
    
    mapping.links.forEach(link => {
        mermaidText += `    ${link.source} ||--o{ ${link.target} : "${link.label}"\n`;
    });
    
    container.innerHTML = `<div class="mermaid">${mermaidText}</div>`;
    
    try {
        await mermaid.run({
            nodes: [container.querySelector('.mermaid')]
        });
    } catch(e) {
        console.error("Mermaid ERD error:", e);
    }
}

function renderTableRows(columns, filterQuery = "") {
    dictionaryBody.innerHTML = "";
    const query = filterQuery.toLowerCase().trim();
    
    columns.forEach((col, idx) => {
        // Search filter matching
        if (query && !col.name.toLowerCase().includes(query) && 
            !col.semantic_type.toLowerCase().includes(query) && 
            !col.description.toLowerCase().includes(query)) {
            return;
        }

        // Highlight matching text helper
        const highlight = (text) => {
            if (!query) return text;
            const regex = new RegExp(`(${query})`, 'gi');
            return text.replace(regex, `<span class="highlight-text">$1</span>`);
        };

        const tr = document.createElement('tr');
        
        // Semantic badges helper
        let badgeClass = "badge-text";
        if (col.semantic_type === "Primary Key" || col.semantic_type === "Unique Identifier") badgeClass = "badge-primary-key";
        else if (col.semantic_type === "Category") badgeClass = "badge-category";
        else if (col.semantic_type === "DateTime") badgeClass = "badge-date";
        else if (col.semantic_type.startsWith("Numeric") || col.semantic_type === "Currency") badgeClass = "badge-numeric";

        // Quality Dot color helper
        let qualityDot = "bg-dot-green";
        let qualityLabel = "Clean Data";
        let investigateBtn = "";
        
        if (col.null_percentage > 20) {
            qualityDot = "bg-dot-red";
            qualityLabel = `${col.null_percentage}% Missing`;
        } else if (col.null_percentage > 0 || col.outliers_count > 0) {
            qualityDot = "bg-dot-yellow";
            qualityLabel = col.null_percentage > 0 ? `${col.null_percentage}% Missing` : `${col.outliers_count} Outliers`;
        }
        
        if (col.outliers_count > 0) {
            // Escape single quotes in column name for the onclick handler
            const safeName = col.name.replace(/'/g, "\\'");
            investigateBtn = `<button class="btn-investigate" onclick="openInvestigateDrawer('${safeName}')"><i class="fa-solid fa-magnifying-glass"></i> Investigate</button>`;
        }

        tr.innerHTML = `
            <td style="color: var(--text-muted); font-weight: 600;">${idx + 1}</td>
            <td style="font-weight: 600; font-family: var(--font-header); font-size: 14px; letter-spacing: 0.2px;">${highlight(col.name)}</td>
            <td>
                <span class="badge ${badgeClass}">${highlight(col.semantic_type)}</span>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Pandas: ${col.pandas_dtype}</div>
            </td>
            <td>
                <div class="indicator-list">
                    <div class="indicator-item">
                        <span class="indicator-dot ${qualityDot}"></span>
                        <span>${qualityLabel}</span>
                    </div>
                    <div style="font-size: 11px; color: var(--text-secondary);">Completeness: ${col.non_null_count.toLocaleString()} rows</div>
                    ${investigateBtn}
                </div>
            </td>
            <td>
                <div class="sample-code">${col.sample_data}</div>
            </td>
            <td>
                <div class="ai-desc-box">
                    <div class="ai-desc-title"><i class="fa-solid fa-brain-circuit text-purple"></i> AI Business Definition</div>
                    <div>${highlight(formatInsight(col.description))}</div>
                </div>
                <div class="action-recommendation">
                    <div class="action-title"><i class="fa-solid fa-circle-exclamation text-cyan"></i> Action Recommendation</div>
                    <div>${formatInsight(col.recommendation)}</div>
                </div>
            </td>
        `;
        
        dictionaryBody.appendChild(tr);
    });
    
    if (dictionaryBody.children.length === 0) {
        dictionaryBody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 40px;">
                    <i class="fa-solid fa-triangle-exclamation" style="font-size: 24px; margin-bottom: 8px;"></i>
                    <div>No columns match your search term.</div>
                </td>
            </tr>
        `;
    }
}

// Interactive Analytics Charting Engine using Chart.js
function drawChart(type, labels, values, chartTitle, targetColName) {
    const ctx = document.getElementById('analyticsChart').getContext('2d');
    
    if (activeChartInstance) {
        activeChartInstance.destroy();
    }
    
    // Create gorgeous cyan-purple gradients
    const gradientFill = ctx.createLinearGradient(0, 0, 0, 300);
    gradientFill.addColorStop(0, 'rgba(6, 182, 212, 0.4)');
    gradientFill.addColorStop(1, 'rgba(139, 92, 246, 0.05)');
    
    const strokeColor = '#06B6D4';
    
    const config = {
        type: type === 'line' ? 'line' : 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: `Average ${targetColName}`,
                data: values,
                backgroundColor: type === 'line' ? gradientFill : 'rgba(139, 92, 246, 0.55)',
                borderColor: type === 'line' ? strokeColor : '#8B5CF6',
                borderWidth: 2,
                fill: true,
                tension: 0.35,
                borderRadius: type === 'line' ? 0 : 6,
                barPercentage: 0.5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    labels: { color: '#9CA3AF', font: { family: 'Inter', size: 11 } }
                },
                tooltip: {
                    backgroundColor: 'rgba(13, 20, 38, 0.9)',
                    borderColor: 'rgba(255,255,255,0.08)',
                    borderWidth: 1,
                    titleColor: '#F3F4F6',
                    bodyColor: '#06B6D4',
                    padding: 12
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#9CA3AF', font: { size: 10 } }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#9CA3AF', font: { size: 10 } }
                }
            }
        }
    };
    
    activeChartInstance = new Chart(ctx, config);
    document.getElementById('chartTitleText').innerHTML = `<i class="fa-solid fa-chart-line text-cyan"></i> ${chartTitle}`;
}

// Manage visual tabs clicking
function setupChartTabs() {
    const tabs = ['tabCat1', 'tabCat2', 'tabTemporal'];
    
    // Hide tabs if dataset doesn't have relevant keys
    document.getElementById('tabCat1').style.display = currentChartsData.categorical_1 ? 'block' : 'none';
    document.getElementById('tabCat2').style.display = currentChartsData.categorical_2 ? 'block' : 'none';
    document.getElementById('tabTemporal').style.display = currentChartsData.temporal ? 'block' : 'none';

    tabs.forEach(tabId => {
        const btn = document.getElementById(tabId);
        btn.onclick = () => {
            switchChartTab(tabId);
        };
    });
}

function switchChartTab(activeTabId) {
    const tabs = ['tabCat1', 'tabCat2', 'tabTemporal'];
    
    // Set active button classes
    tabs.forEach(id => {
        const btn = document.getElementById(id);
        if (id === activeTabId) {
            btn.classList.add('btn-active');
        } else {
            btn.classList.remove('btn-active');
        }
    });

    if (activeTabId === 'tabCat1' && currentChartsData.categorical_1) {
        const item = currentChartsData.categorical_1;
        drawChart('bar', Object.keys(item.data), Object.values(item.data), `Distribution Analysis: Average ${item.target} by ${item.column}`, item.target);
    } else if (activeTabId === 'tabCat2' && currentChartsData.categorical_2) {
        const item = currentChartsData.categorical_2;
        drawChart('bar', Object.keys(item.data), Object.values(item.data), `Parameter Comparison: Average ${item.target} by ${item.column}`, item.target);
    } else if (activeTabId === 'tabTemporal' && currentChartsData.temporal) {
        const item = currentChartsData.temporal;
        drawChart('line', Object.keys(item.data), Object.values(item.data), `Temporal Timeline Analysis: Average ${item.target} by ${item.column}`, item.target);
    }
}

// Set up Live Filter Search
tableSearch.addEventListener('input', (e) => {
    if (activeDataset) {
        renderTableRows(activeDataset.columns, e.target.value);
    }
});

// Reset Dashboard
function resetToUpload() {
    currentFileId = null;
    activeDataset = null;
    currentChartsData = null;
    currentDdlPayload = null;
    tableSearch.value = "";
    document.getElementById('datasetContext').value = "";
    
    if (activeChartInstance) {
        activeChartInstance.destroy();
        activeChartInstance = null;
    }
    
    document.getElementById('sqlDdlCard').style.display = 'none';
    document.getElementById('cleanCard').style.display = 'none';
    document.getElementById('chatCard').style.display = 'none';
    document.getElementById('erdCard').style.display = 'none';
    document.getElementById('btnDownloadCleaned').style.display = 'none';
    document.getElementById('btnDownloadCleaned').href = '#';
    dashboardWorkspace.style.display = 'none';
    loadingState.style.display = 'none';
    uploadCard.style.display = 'block';
}

document.getElementById('btnReset').addEventListener('click', () => {
    if (currentFileId) {
        fetch(`${BACKEND_URL}/api/reset/${currentFileId}`, { method: 'POST' }).catch(e => console.error(e));
    }
    resetToUpload();
});

// Export Actions
document.getElementById('btnExportJson').addEventListener('click', () => {
    if (currentFileId) {
        window.location.href = `${BACKEND_URL}/api/export/${currentFileId}/json`;
    }
});

document.getElementById('btnExportMarkdown').addEventListener('click', () => {
    if (currentFileId) {
        window.location.href = `${BACKEND_URL}/api/export/${currentFileId}/markdown`;
    }
});

// DDL Generator Tab & Copy Logic
let currentDdlPayload = null;
let activeDdlDb = "postgresql";

function setupDdlTabs(ddlPayload) {
    currentDdlPayload = ddlPayload;
    
    // Default to postgresql
    switchDdlTab("postgresql");
    
    const tabsContainer = document.getElementById('ddlTabsContainer');
    const tabs = tabsContainer.querySelectorAll('.sql-tab');
    
    tabs.forEach(tab => {
        tab.onclick = (e) => {
            const btn = e.target.closest('.sql-tab');
            if (btn) {
                const dbType = btn.getAttribute('data-db');
                switchDdlTab(dbType);
            }
        };
    });
}

function switchDdlTab(dbType) {
    activeDdlDb = dbType;
    const tabsContainer = document.getElementById('ddlTabsContainer');
    const tabs = tabsContainer.querySelectorAll('.sql-tab');
    
    tabs.forEach(tab => {
        if (tab.getAttribute('data-db') === dbType) {
            tab.classList.add('btn-active');
        } else {
            tab.classList.remove('btn-active');
        }
    });
    
    const codeBlock = document.getElementById('sqlDdlCode');
    if (currentDdlPayload && currentDdlPayload[dbType]) {
        codeBlock.textContent = currentDdlPayload[dbType];
    } else {
        codeBlock.textContent = "-- No DDL code available for this database engine.";
    }
}

// Copy to Clipboard
document.getElementById('btnCopyDdl').onclick = () => {
    const codeText = document.getElementById('sqlDdlCode').textContent;
    navigator.clipboard.writeText(codeText).then(() => {
        const btn = document.getElementById('btnCopyDdl');
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-check" style="color: var(--emerald-green);"></i> Copied!`;
        btn.style.background = "rgba(16, 185, 129, 0.25)";
        btn.style.borderColor = "var(--emerald-green)";
        setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.style.background = "";
            btn.style.borderColor = "";
        }, 2000);
    }).catch(err => {
        alert("Failed to copy code to clipboard: " + err);
    });
};

// Data Cleaning Studio Logic
document.getElementById('btnOpenCleaner').addEventListener('click', () => {
    const cleanCard = document.getElementById('cleanCard');
    cleanCard.style.display = 'block';
    cleanCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.getElementById('btnCloseCleaner').addEventListener('click', () => {
    document.getElementById('cleanCard').style.display = 'none';
});

document.getElementById('btnExecuteClean').addEventListener('click', async () => {
    if (!currentFileId) return;
    
    const executeBtn = document.getElementById('btnExecuteClean');
    const originalText = executeBtn.innerHTML;
    executeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Cleaning...';
    executeBtn.disabled = true;
    
    const noiseValueRaw = document.getElementById('cleanNoiseValue').value;
    const noiseValue = noiseValueRaw ? Number(noiseValueRaw) : null;
    const numericImputation = document.getElementById('cleanNumericImputation').value;
    const categoricalImputation = document.getElementById('cleanCategoricalImputation').value;
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/clean`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                file_id: currentFileId,
                noise_value: noiseValue,
                numeric_imputation: numericImputation,
                categorical_imputation: categoricalImputation
            })
        });
        
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.detail || 'Cleaning failed');
        }
        
        const data = await response.json();
        
        // Success
        executeBtn.innerHTML = '<i class="fa-solid fa-check"></i> Cleaned Successfully!';
        executeBtn.style.background = "linear-gradient(135deg, var(--emerald-green), var(--cyan-electric))";
        
        const downloadBtn = document.getElementById('btnDownloadCleaned');
        downloadBtn.style.display = 'inline-flex';
        downloadBtn.href = `${BACKEND_URL}/api/download/${data.clean_file_id}`;
        downloadBtn.setAttribute('download', data.download_name || 'cleaned_dataset.csv');
        
        setTimeout(() => {
            executeBtn.innerHTML = originalText;
            executeBtn.style.background = "";
            executeBtn.disabled = false;
        }, 3000);
        
    } catch (err) {
        alert(`Error during cleaning: ${err.message}`);
        executeBtn.innerHTML = originalText;
        executeBtn.disabled = false;
    }
});

// Slide-out Drawer Logic for Outlier Investigator
const drawerOverlay = document.getElementById('drawerOverlay');
const outlierDrawer = document.getElementById('outlierDrawer');
const drawerContent = document.getElementById('drawerContent');

function closeDrawer() {
    outlierDrawer.classList.remove('open');
    drawerOverlay.classList.remove('active');
}

document.getElementById('btnCloseDrawer').addEventListener('click', closeDrawer);
drawerOverlay.addEventListener('click', closeDrawer);

async function openInvestigateDrawer(colName) {
    outlierDrawer.classList.add('open');
    drawerOverlay.classList.add('active');
    
    drawerContent.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
            <i class="fa-solid fa-spinner fa-spin" style="font-size: 30px; color: var(--cyan-electric); margin-bottom: 15px;"></i>
            <p>Fetching outliers and generating expert AI explanation...</p>
        </div>
    `;
    
    try {
        const contextObj = document.getElementById('datasetContext');
        const context = contextObj ? contextObj.value : "";
        const response = await fetch(`${BACKEND_URL}/api/investigate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId, col_name: colName, dataset_context: context })
        });
        
        if (!response.ok) throw new Error("Failed to fetch investigation data");
        
        const data = await response.json();
        
        let html = `
            <div class="ai-explanation-card">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                    <i class="fa-solid fa-brain-circuit text-purple" style="font-size: 18px;"></i>
                    <h4 style="font-family: var(--font-header); font-size: 14px; color: #A78BFA; margin: 0;">AI Outlier Hypothesis</h4>
                </div>
                <p style="font-size: 13px; line-height: 1.6;">${data.explanation}</p>
            </div>
            
            <h4 style="font-family: var(--font-header); font-size: 14px; margin-bottom: 15px; color: var(--text-secondary); border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">Top Extreme Outliers</h4>
        `;
        
        if (data.outliers && data.outliers.length > 0) {
            data.outliers.forEach((out, idx) => {
                const contextStr = JSON.stringify(out.context, null, 2);
                html += `
                    <div class="outlier-card">
                        <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">#${idx+1} | Row Index: ${out.row_index}</div>
                        <div class="outlier-val">${out.value}</div>
                        <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">Full Row Context:</div>
                        <div class="outlier-context">${contextStr}</div>
                    </div>
                `;
            });
        } else {
            html += `<p style="color: var(--text-muted); font-size: 13px;">No extreme outliers to display.</p>`;
        }
        
        drawerContent.innerHTML = html;
        
    } catch (err) {
        drawerContent.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #FDA4AF;">
                <i class="fa-solid fa-triangle-exclamation" style="font-size: 30px; margin-bottom: 15px;"></i>
                <p>Error: ${err.message}</p>
            </div>
        `;
    }
}

// Dataset Chat Logic
const chatInput = document.getElementById('chatInput');
const btnSendChat = document.getElementById('btnSendChat');
const chatMessages = document.getElementById('chatMessages');

chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendChatMessage();
    }
});

btnSendChat.addEventListener('click', sendChatMessage);

async function sendChatMessage() {
    if (!currentFileId) {
        alert("Please upload a dataset first.");
        return;
    }
    
    const msg = chatInput.value.trim();
    if (!msg) return;
    
    // Add user message to UI
    appendChatMsg('user', msg);
    chatInput.value = '';
    
    // Add typing indicator
    const typingId = 'typing-' + Date.now();
    appendChatMsg('ai', '<i class="fa-solid fa-ellipsis fa-bounce"></i> Generating pandas code and executing...', typingId);
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: currentFileId, message: msg })
        });
        
        const data = await response.json();
        
        // Remove typing indicator
        const typingEl = document.getElementById(typingId);
        if (typingEl) typingEl.remove();
        
        // Build AI response
        let finalHtml = `<div>${data.reply || data.error}</div>`;
        
        if (data.code) {
            finalHtml += `<div class="code-block">${data.code}</div>`;
        }
        
        if (data.table_data && data.table_data.columns) {
            let tableHtml = `<table class="chat-table"><thead><tr>`;
            data.table_data.columns.forEach(c => tableHtml += `<th>${c}</th>`);
            tableHtml += `</tr></thead><tbody>`;
            data.table_data.rows.forEach(r => {
                tableHtml += `<tr>`;
                r.forEach(cell => tableHtml += `<td>${cell}</td>`);
                tableHtml += `</tr>`;
            });
            tableHtml += `</tbody></table>`;
            finalHtml += tableHtml;
        }
        
        appendChatMsg('ai', finalHtml);
        
    } catch (err) {
        const typingEl = document.getElementById(typingId);
        if (typingEl) typingEl.remove();
        appendChatMsg('ai', `<span style="color: #FDA4AF;"><i class="fa-solid fa-triangle-exclamation"></i> Network error: ${err.message}</span>`);
    }
}

function appendChatMsg(role, htmlContent, id = null) {
    const div = document.createElement('div');
    div.className = `chat-msg ${role === 'user' ? 'user-msg' : 'ai-msg'}`;
    if (id) div.id = id;
    
    const avatar = role === 'user' 
        ? `<div class="msg-avatar"><i class="fa-solid fa-user"></i></div>`
        : `<div class="msg-avatar bg-purple-trans"><i class="fa-solid fa-robot text-purple"></i></div>`;
        
    div.innerHTML = `
        ${avatar}
        <div class="msg-bubble">${htmlContent}</div>
    `;
    
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}
