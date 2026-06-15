import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api/client";
import "./style.css";

const ACTIVE_STEPS = ["ASSIGNED", "ENROUTE", "CHARGING", "STOP_REQUESTED"];

function App() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Slot states
  const [slots, setSlots] = useState([]);
  const [slotsError, setSlotsError] = useState("");
  const [newSlotId, setNewSlotId] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState(
    localStorage.getItem("whatsapp_bot_number") || "+911219266364"
  );
  const [activeQRModal, setActiveQRModal] = useState(null);
  const [copiedSlotId, setCopiedSlotId] = useState(null);

  async function loadData() {
    try {
      setError("");
      const res = await api.get("/juicer/jobs/all");
      setJobs(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error(err);
      setError("Could not load admin data from backend.");
    }
  }

  async function loadSlots() {
    try {
      setSlotsError("");
      const res = await api.get("/admin/slots");
      setSlots(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error(err);
      setSlotsError("Could not load parking slots from backend.");
    }
  }

  async function initDashboard() {
    setLoading(true);
    await Promise.all([loadData(), loadSlots()]);
    setLoading(false);
  }

  useEffect(() => {
    initDashboard();
    const interval = setInterval(() => {
      loadData();
      loadSlots();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const stats = useMemo(() => {
    const active = jobs.filter((job) => ACTIVE_STEPS.includes(job.current_step));
    const completed = jobs.filter((job) => job.current_step === "COMPLETED");
    const charging = jobs.filter((job) => job.current_step === "CHARGING");
    const stopped = jobs.filter((job) => job.current_step === "STOP_REQUESTED");

    return {
      total: jobs.length,
      active: active.length,
      completed: completed.length,
      charging: charging.length,
      stopped: stopped.length,
    };
  }, [jobs]);

  const chargerRows = useMemo(() => {
    const baseChargers = ["CHARGER_001", "CHARGER_002", "CHARGER_003", "CHARGER_004"];

    return baseChargers.map((chargerId, index) => {
      const activeJob = jobs.find((job) => job.current_step === "CHARGING" && index === 0);
      const stopJob = jobs.find((job) => job.current_step === "STOP_REQUESTED" && index === 0);

      let status = "AVAILABLE";
      let job = null;

      if (activeJob) {
        status = "BUSY";
        job = activeJob;
      }

      if (stopJob) {
        status = "STOP REQUESTED";
        job = stopJob;
      }

      return {
        chargerId,
        status,
        job,
      };
    });
  }, [jobs]);

  const juicerRows = useMemo(() => {
    const baseJuicers = [
      { id: "JCR_001", name: "Juicer One" },
      { id: "JCR_002", name: "Juicer Two" },
      { id: "JCR_003", name: "Juicer Three" },
    ];

    const activeJob = jobs.find((job) => ["ENROUTE", "CHARGING", "STOP_REQUESTED"].includes(job.current_step));

    return baseJuicers.map((juicer, index) => ({
      ...juicer,
      status: index === 0 && activeJob ? "ON JOB" : "AVAILABLE",
      job: index === 0 ? activeJob : null,
    }));
  }, [jobs]);

  const recentJobs = useMemo(() => {
    return [...jobs]
      .sort((a, b) => new Date(b.created_at || b.updated_at) - new Date(a.created_at || a.updated_at))
      .slice(0, 12);
  }, [jobs]);

  // Slot management functions
  async function handleCreateSlot(e) {
    e.preventDefault();
    const cleanId = newSlotId.trim().toUpperCase();
    if (!cleanId) return;
    try {
      setCreateLoading(true);
      setSlotsError("");
      await api.post("/admin/slots", { slot_id: cleanId });
      setNewSlotId("");
      await loadSlots();
    } catch (err) {
      console.error(err);
      setSlotsError(err?.response?.data?.detail || "Could not create slot.");
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleToggleSlot(slotId) {
    try {
      setSlotsError("");
      await api.post(`/admin/slots/${slotId}/toggle`);
      await loadSlots();
    } catch (err) {
      console.error(err);
      setSlotsError("Could not toggle slot status.");
    }
  }

  async function handleRegenerateSlotQR(slotId) {
    if (
      !window.confirm(
        `Are you sure you want to regenerate the QR code for slot ${slotId}? The old QR code token will be invalidated immediately!`
      )
    ) {
      return;
    }
    try {
      setSlotsError("");
      await api.post(`/admin/slots/${slotId}/regenerate`);
      await loadSlots();
    } catch (err) {
      console.error(err);
      setSlotsError("Could not regenerate QR code.");
    }
  }

  async function handleDeleteSlot(slotId) {
    if (!window.confirm(`Are you sure you want to delete slot ${slotId}?`)) {
      return;
    }
    try {
      setSlotsError("");
      await api.delete(`/admin/slots/${slotId}`);
      await loadSlots();
    } catch (err) {
      console.error(err);
      setSlotsError("Could not delete slot.");
    }
  }

  async function downloadQRCode(slotId, qrUrl) {
    try {
      const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(
        qrUrl
      )}`;
      const response = await fetch(qrImageUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `Juicer_QR_${slotId}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Failed to download QR code image", err);
      window.open(
        `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(
          qrUrl
        )}`,
        "_blank"
      );
    }
  }

  function printQRCode(slotId, qrUrl) {
    const printWindow = window.open("", "_blank", "width=600,height=600");
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(
      qrUrl
    )}`;

    printWindow.document.write(`
      <html>
        <head>
          <title>Print QR Code - Slot ${slotId}</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              text-align: center;
              padding: 40px;
              color: #1a202c;
            }
            .container {
              border: 3px double #e2e8f0;
              border-radius: 24px;
              padding: 40px;
              max-width: 450px;
              margin: 0 auto;
              box-shadow: 0 4px 6px rgba(0,0,0,0.05);
            }
            .logo {
              font-size: 28px;
              font-weight: bold;
              color: #2563eb;
              margin-bottom: 8px;
            }
            .logo span {
              color: #f59e0b;
            }
            .slot-title {
              font-size: 36px;
              font-weight: 800;
              margin: 10px 0;
              letter-spacing: 0.05em;
            }
            .qr-image {
              margin: 20px 0;
              width: 300px;
              height: 300px;
            }
            .instructions {
              font-size: 16px;
              color: #4a5568;
              margin-top: 15px;
              line-height: 1.5;
            }
            .footer {
              margin-top: 30px;
              font-size: 12px;
              color: #a0aec0;
            }
            @media print {
              body { padding: 0; }
              .container { border: none; box-shadow: none; }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="logo">JUICER <span>⚡</span></div>
            <div style="color: #4a5568; font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em;">EV Charging Slot</div>
            <div class="slot-title">SLOT ${slotId}</div>
            <img class="qr-image" src="${qrImageUrl}" alt="QR Code for Slot ${slotId}" />
            <div class="instructions">
              <strong>Scan to request charging</strong><br/>
              Open your camera, scan the QR code to message our WhatsApp bot and start charging!
            </div>
            <div class="footer">Powered by Juicer System</div>
          </div>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }

  function handleCopy(slotId, text) {
    navigator.clipboard.writeText(text);
    setCopiedSlotId(slotId);
    setTimeout(() => setCopiedSlotId(null), 2000);
  }

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Company Console</p>
          <h1>Juicer Admin Dashboard</h1>
          <p className="subtitle">Analyse operations, monitor chargers, and manage field juicers.</p>
        </div>

        <button className="refresh" onClick={initDashboard}>Refresh</button>
      </header>

      {error && <div className="error">{error}</div>}

      {loading ? (
        <div className="loading">Loading admin dashboard...</div>
      ) : (
        <>
          <section className="metrics">
            <Metric title="Total Jobs" value={stats.total} />
            <Metric title="Active Queue" value={stats.active} />
            <Metric title="Charging" value={stats.charging} />
            <Metric title="Completed" value={stats.completed} />
            <Metric title="Stop Requests" value={stats.stopped} />
          </section>

          <section className="layout-two">
            <Panel title="Chargers" description="Maintain charger health and current utilization.">
              <div className="table">
                <div className="table-head chargers-grid">
                  <span>Charger</span>
                  <span>Status</span>
                  <span>Current Job</span>
                </div>

                {chargerRows.map((item) => (
                  <div className="table-row chargers-grid" key={item.chargerId}>
                    <strong>{item.chargerId}</strong>
                    <Badge value={item.status} />
                    <span>{item.job ? `${item.job.slot_id} / ${item.job.vehicle_number}` : "—"}</span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Juicers" description="Track field operator availability and active assignment.">
              <div className="table">
                <div className="table-head juicers-grid">
                  <span>Juicer</span>
                  <span>Status</span>
                  <span>Assigned Job</span>
                </div>

                {juicerRows.map((item) => (
                  <div className="table-row juicers-grid" key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <small>{item.id}</small>
                    </div>
                    <Badge value={item.status} />
                    <span>{item.job ? `${item.job.slot_id} / ${item.job.vehicle_number}` : "—"}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </section>

          {/* QR Code Parking Slots Management Panel */}
          <Panel 
            title="QR Code Parking Slots" 
            description="Create slots, activate/deactivate QR codes, and generate secure tokens for customer scan-to-charge."
          >
            <div className="panel-actions-bar">
              <form onSubmit={handleCreateSlot} className="add-slot-form">
                <input
                  type="text"
                  placeholder="e.g. S5"
                  value={newSlotId}
                  onChange={(e) => setNewSlotId(e.target.value)}
                  required
                  className="slot-input"
                />
                <button type="submit" disabled={createLoading} className="add-slot-btn">
                  {createLoading ? "Creating..." : "Add Slot"}
                </button>
              </form>
              
              <div className="whatsapp-bot-config">
                <label htmlFor="bot-num">Bot Number:</label>
                <input
                  id="bot-num"
                  type="text"
                  placeholder="+911219266364"
                  value={whatsappNumber}
                  onChange={(e) => {
                    setWhatsappNumber(e.target.value);
                    localStorage.setItem("whatsapp_bot_number", e.target.value);
                  }}
                  className="bot-input"
                />
              </div>
            </div>

            {slotsError && <div className="error">{slotsError}</div>}

            <div className="table">
              <div className="table-head slots-grid">
                <span>Slot</span>
                <span>Status</span>
                <span>Secure QR Link / Token</span>
                <span>Created At</span>
                <span>Actions</span>
              </div>

              {slots.length === 0 ? (
                <div className="empty">No parking slots registered. Add one above.</div>
              ) : (
                slots.map((slot) => {
                  const qrUrl = `https://wa.me/${whatsappNumber.replace(/[+ ]/g, "")}?text=Charge_Request_Slot_${slot.qr_token}`;
                  return (
                    <div className="table-row slots-grid" key={slot.slot_id}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div 
                          className="slot-qr-preview-container" 
                          onClick={() => setActiveQRModal({ slot_id: slot.slot_id, qrUrl })}
                          title="Click to view large QR code"
                        >
                          <img 
                            className="slot-qr-thumbnail" 
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(qrUrl)}`} 
                            alt="QR code thumbnail"
                          />
                        </div>
                        <strong>{slot.slot_id}</strong>
                      </div>
                      
                      <Badge value={slot.is_active ? "Active" : "Deactivated"} />
                      
                      <div className="qr-link-container">
                        <span className="qr-link-text" title={qrUrl}>{qrUrl}</span>
                        <button 
                          className="copy-btn" 
                          onClick={() => handleCopy(slot.slot_id, qrUrl)}
                          title="Copy deep link"
                        >
                          {copiedSlotId === slot.slot_id ? "Copied!" : "📋"}
                        </button>
                      </div>

                      <span>{slot.created_at ? new Date(slot.created_at).toLocaleDateString() : "—"}</span>

                      <div className="slot-actions">
                        <button 
                          onClick={() => handleToggleSlot(slot.slot_id)}
                          className={`action-btn ${slot.is_active ? "" : "action-btn-primary"}`}
                        >
                          {slot.is_active ? "Deactivate" : "Activate"}
                        </button>
                        
                        <button 
                          onClick={() => handleRegenerateSlotQR(slot.slot_id)}
                          className="action-btn"
                          title="Regenerate secure token if QR was compromised"
                        >
                          🔄 Regenerate
                        </button>

                        <button 
                          onClick={() => downloadQRCode(slot.slot_id, qrUrl)}
                          className="action-btn action-btn-primary"
                        >
                          💾 PNG
                        </button>

                        <button 
                          onClick={() => printQRCode(slot.slot_id, qrUrl)}
                          className="action-btn"
                        >
                          🖨️ Print
                        </button>

                        <button 
                          onClick={() => handleDeleteSlot(slot.slot_id)}
                          className="action-btn action-btn-danger"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Panel>

          <Panel title="Recent Jobs" description="Latest customer charging requests and operational status.">
            <div className="table">
              <div className="table-head jobs-grid">
                <span>Slot</span>
                <span>Vehicle</span>
                <span>Phone</span>
                <span>Status</span>
                <span>Job ID</span>
              </div>

              {recentJobs.length === 0 ? (
                <div className="empty">No jobs found.</div>
              ) : (
                recentJobs.map((job) => (
                  <div className="table-row jobs-grid" key={job.job_id}>
                    <strong>{job.slot_id}</strong>
                    <span>{job.vehicle_number || "Pending"}</span>
                    <span>{job.phone_number}</span>
                    <Badge value={job.current_step} />
                    <span>{job.job_id.slice(0, 8)}</span>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </>
      )}

      {/* Large QR Modal Overlay */}
      {activeQRModal && (
        <div className="modal-overlay" onClick={() => setActiveQRModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setActiveQRModal(null)}>×</button>
            <h2>Slot {activeQRModal.slot_id} QR Code</h2>
            <p className="subtitle" style={{ margin: "5px 0 0" }}>Scan to request charging at Slot {activeQRModal.slot_id}</p>
            
            <div className="modal-qr-container">
              <img 
                className="modal-qr-img" 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(activeQRModal.qrUrl)}`} 
                alt={`QR code for slot ${activeQRModal.slot_id}`}
              />
            </div>
            
            <p style={{ fontSize: "11px", color: "#64748b", wordBreak: "break-all", fontFamily: "monospace", padding: "0 10px", margin: "10px 0" }}>
              {activeQRModal.qrUrl}
            </p>

            <div className="modal-actions">
              <button 
                onClick={() => downloadQRCode(activeQRModal.slot_id, activeQRModal.qrUrl)}
                className="action-btn action-btn-primary"
                style={{ padding: "10px 20px" }}
              >
                💾 Download PNG
              </button>
              
              <button 
                onClick={() => printQRCode(activeQRModal.slot_id, activeQRModal.qrUrl)}
                className="action-btn"
                style={{ padding: "10px 20px" }}
              >
                🖨️ Print Signage
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Metric({ title, value }) {
  return (
    <article className="metric-card">
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Panel({ title, description, children }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Badge({ value }) {
  const className = `badge badge-${String(value).toLowerCase().replaceAll(" ", "_")}`;
  return <span className={className}>{value}</span>;
}

createRoot(document.getElementById("root")).render(<App />);
