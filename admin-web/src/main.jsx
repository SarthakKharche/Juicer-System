import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
import { api } from "./api/client";
import "./style.css";

const ACTIVE_STEPS = ["ASSIGNED", "ENROUTE", "CHARGING", "STOP_REQUESTED"];

function App() {
  const [jobs, setJobs] = useState([]);
  const [buildings, setBuildings] = useState([]);
  const [slots, setSlots] = useState([]);
  const [selectedBuildingId, setSelectedBuildingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [slotLoading, setSlotLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activeTab, setActiveTab] = useState("dashboard"); // "dashboard", "chargers", "juicers", "sessions", "jobs", "qr-management"

  // Sessions filter states
  const [sessBuildingFilter, setSessBuildingFilter] = useState("ALL");
  const [sessSlotSearch, setSessSlotSearch] = useState("");
  const [sessVehicleSearch, setSessVehicleSearch] = useState("");
  const [sessPhoneSearch, setSessPhoneSearch] = useState("");
  const [sessStatusFilter, setSessStatusFilter] = useState("ALL");
  const [appliedSessFilters, setAppliedSessFilters] = useState({
    building: "ALL",
    slot: "",
    vehicle: "",
    phone: "",
    status: "ALL"
  });

  const [buildingForm, setBuildingForm] = useState({
    building_name: "",
    building_type: "Residential",
    address: "",
  });

  const [slotForm, setSlotForm] = useState({
    slot_id: "",
    floor: "",
    zone: "",
  });

  const [jobSearch, setJobSearch] = useState("");
  const [jobStatusFilter, setJobStatusFilter] = useState("ALL");
  const [jobBuildingFilter, setJobBuildingFilter] = useState("ALL");
  const [jobFromDate, setJobFromDate] = useState("");
  const [jobToDate, setJobToDate] = useState("");

  const existingBuildingIds = useMemo(
    () => new Set(buildings.map((building) => building.building_id)),
    [buildings],
  );

  const autoBuildingId = useMemo(
    () => generateUniqueBuildingId(buildingForm.building_name, existingBuildingIds),
    [buildingForm.building_name, existingBuildingIds],
  );

  async function loadData() {
    try {
      setError("");
      const res = await api.get("/juicer/jobs/all");
      setJobs(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error(err);
      setError("Could not load admin data from backend.");
    } finally {
      setLoading(false);
    }
  }

  async function loadBuildings() {
    try {
      const res = await api.get("/admin/buildings");
      const data = Array.isArray(res.data) ? res.data : [];
      setBuildings(data);

      if (!selectedBuildingId && data.length > 0) {
        setSelectedBuildingId(data[0].building_id);
      }
    } catch (err) {
      console.error(err);
      setError("Could not load buildings.");
    }
  }

  async function loadSlots(buildingId = selectedBuildingId) {
    try {
      setSlotLoading(true);
      const url = buildingId ? `/admin/buildings/${buildingId}/slots` : "/admin/slots";
      const res = await api.get(url);
      setSlots(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error(err);
      setError("Could not load parking slots.");
    } finally {
      setSlotLoading(false);
    }
  }

  async function refreshAll() {
    await Promise.all([loadData(), loadBuildings()]);
  }

  useEffect(() => {
    refreshAll();
    const interval = setInterval(loadData, activeTab === "sessions" ? 3000 : 10000);
    return () => clearInterval(interval);
  }, [activeTab]);

  useEffect(() => {
    if (selectedBuildingId) {
      loadSlots(selectedBuildingId);
    } else {
      setSlots([]);
    }
  }, [selectedBuildingId]);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(""), 4000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

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

      return { chargerId, status, job };
    });
  }, [jobs]);

  const juicerRows = useMemo(() => {
    const baseJuicers = [
      { id: "JCR_001", name: "Juicer One" },
      { id: "JCR_002", name: "Juicer Two" },
      { id: "JCR_003", name: "Juicer Three" },
    ];

    const activeJobs = jobs.filter((job) => ACTIVE_STEPS.includes(job.current_step));

    return baseJuicers.map((juicer, index) => {
      const job = activeJobs[index];
      return {
        ...juicer,
        status: job ? "ASSIGNED" : "AVAILABLE",
        job,
      };
    });
  }, [jobs]);

  const jobStatusOptions = useMemo(() => {
    const statuses = new Set();
    jobs.forEach((job) => {
      if (job.current_step) statuses.add(job.current_step);
    });
    return Array.from(statuses).sort();
  }, [jobs]);

  const jobBuildingOptions = useMemo(() => {
    const map = new Map();

    jobs.forEach((job) => {
      const id = job.building_id || job.building_name;
      if (!id) return;
      map.set(id, job.building_name || job.building_id);
    });

    buildings.forEach((building) => {
      if (building.building_id) {
        map.set(building.building_id, building.building_name || building.building_id);
      }
    });

    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [jobs, buildings]);

  const filteredJobs = useMemo(() => {
    const search = jobSearch.trim().toLowerCase();

    return [...jobs]
      .filter((job) => {
        const haystack = [
          job.job_id,
          job.slot_id,
          job.vehicle_number,
          job.phone_number,
          job.phone,
          job.current_step,
          job.building_id,
          job.building_name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (search && !haystack.includes(search)) return false;

        if (jobStatusFilter !== "ALL" && job.current_step !== jobStatusFilter) {
          return false;
        }

        if (jobBuildingFilter !== "ALL") {
          const jobBuildingValue = job.building_id || job.building_name || "";
          if (jobBuildingValue !== jobBuildingFilter) return false;
        }

        const dateValue = job.created_at || job.updated_at;

        if (jobFromDate && dateValue) {
          const from = new Date(`${jobFromDate}T00:00:00`);
          if (new Date(dateValue) < from) return false;
        }

        if (jobToDate && dateValue) {
          const to = new Date(`${jobToDate}T23:59:59`);
          if (new Date(dateValue) > to) return false;
        }

        return true;
      })
      .sort((a, b) => new Date(b.created_at || b.updated_at) - new Date(a.created_at || a.updated_at));
  }, [jobs, jobSearch, jobStatusFilter, jobBuildingFilter, jobFromDate, jobToDate]);

  const recentJobs = useMemo(() => filteredJobs.slice(0, 25), [filteredJobs]);

  function clearJobFilters() {
    setJobSearch("");
    setJobStatusFilter("ALL");
    setJobBuildingFilter("ALL");
    setJobFromDate("");
    setJobToDate("");
  }

  function handleSessFilter(e) {
    if (e) e.preventDefault();
    setAppliedSessFilters({
      building: sessBuildingFilter,
      slot: sessSlotSearch,
      vehicle: sessVehicleSearch,
      phone: sessPhoneSearch,
      status: sessStatusFilter
    });
  }

  function handleSessReset() {
    setSessBuildingFilter("ALL");
    setSessSlotSearch("");
    setSessVehicleSearch("");
    setSessPhoneSearch("");
    setSessStatusFilter("ALL");
    setAppliedSessFilters({
      building: "ALL",
      slot: "",
      vehicle: "",
      phone: "",
      status: "ALL"
    });
  }

  const filteredSessions = useMemo(() => {
    return jobs
      .filter((job) => {
        // Building filter
        if (appliedSessFilters.building !== "ALL") {
          const jobBuildingValue = job.building_id || job.building_name || "";
          if (jobBuildingValue !== appliedSessFilters.building) {
            return false;
          }
        }
        // Slot filter
        if (appliedSessFilters.slot) {
          const slotMatch = (job.slot_id || "").toLowerCase();
          if (!slotMatch.includes(appliedSessFilters.slot.toLowerCase())) {
            return false;
          }
        }
        // Vehicle filter
        if (appliedSessFilters.vehicle) {
          const vehicleMatch = (job.vehicle_number || "").toLowerCase();
          if (!vehicleMatch.includes(appliedSessFilters.vehicle.toLowerCase())) {
            return false;
          }
        }
        // Phone filter
        if (appliedSessFilters.phone) {
          const phoneMatch = (job.phone_number || job.phone || "").toLowerCase();
          if (!phoneMatch.includes(appliedSessFilters.phone.toLowerCase())) {
            return false;
          }
        }
        // Status filter
        if (appliedSessFilters.status !== "ALL") {
          if (appliedSessFilters.status === "ACTIVE") {
            if (!ACTIVE_STEPS.includes(job.current_step)) return false;
          } else {
            if (job.current_step !== appliedSessFilters.status) return false;
          }
        }
        return true;
      })
      .sort((a, b) => new Date(b.created_at || b.updated_at) - new Date(a.created_at || a.updated_at));
  }, [jobs, appliedSessFilters]);

  async function handleCreateBuilding(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    try {
      const payload = {
        building_name: buildingForm.building_name.trim(),
        building_type: buildingForm.building_type || null,
        address: buildingForm.address.trim() || null,
      };

      if (!payload.building_name) {
        setError("Building name is required.");
        return;
      }

      const res = await api.post("/admin/buildings", payload);
      setBuildingForm({ building_name: "", building_type: "Residential", address: "" });
      setSelectedBuildingId(res.data.building_id);
      setSuccess("Building created successfully.");
      await loadBuildings();
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.detail || "Could not create building.");
    }
  }

  async function handleCreateSlot(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!selectedBuildingId) {
      setError("Create or select a building first.");
      return;
    }

    try {
      const payload = {
        slot_id: slotForm.slot_id.trim().toUpperCase().replaceAll(" ", "_"),
        floor: slotForm.floor.trim() || null,
        zone: slotForm.zone.trim() || null,
      };

      if (!payload.slot_id) {
        setError("Slot ID is required.");
        return;
      }

      await api.post(`/admin/buildings/${selectedBuildingId}/slots`, payload);
      setSlotForm({ slot_id: "", floor: "", zone: "" });
      setSuccess("Parking slot QR created successfully.");
      await loadSlots(selectedBuildingId);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.detail || "Could not create parking slot.");
    }
  }

  async function toggleSlot(parkingSlotId) {
    try {
      setError("");
      setSuccess("");
      await api.post(`/admin/slots/${parkingSlotId}/toggle`);
      setSuccess("Slot status updated.");
      await loadSlots(selectedBuildingId);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.detail || "Could not update slot status.");
    }
  }

  async function regenerateSlot(parkingSlotId) {
    try {
      setError("");
      setSuccess("");
      await api.post(`/admin/slots/${parkingSlotId}/regenerate`);
      setSuccess("QR regenerated successfully.");
      await loadSlots(selectedBuildingId);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.detail || "Could not regenerate QR.");
    }
  }

  async function deleteSlot(parkingSlotId) {
    const ok = window.confirm("Delete this parking slot QR?");
    if (!ok) return;

    try {
      setError("");
      setSuccess("");
      await api.delete(`/admin/slots/${parkingSlotId}`);
      setSuccess("Parking slot deleted.");
      await loadSlots(selectedBuildingId);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.detail || "Could not delete slot.");
    }
  }

  function getQrImageUrl(slot) {
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(slot.qr_link)}`;
  }

  async function copyText(text) {
    await navigator.clipboard.writeText(text);
    setSuccess("Copied to clipboard.");
  }

  function getManualCommand(slot) {
    return `Charge_Request_Building_${slot.building_id}_Slot_${slot.slot_id}`;
  }

  async function downloadQrCard(slot) {
    try {
      const qrValue = slot.qr_link;
      const manualCommand = getManualCommand(slot);

      const canvas = document.createElement("canvas");
      canvas.width = 900;
      canvas.height = 1250;

      const ctx = canvas.getContext("2d");

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      roundRect(ctx, 55, 45, 790, 1160, 36, "#ffffff", "#e5e7eb");

      ctx.fillStyle = "#111827";
      ctx.font = "bold 50px Arial";
      ctx.textAlign = "center";
      ctx.fillText("Juicer EV Charging", 450, 125);

      ctx.fillStyle = "#4b5563";
      ctx.font = "28px Arial";
      ctx.fillText("Scan QR to request charging", 450, 175);

      roundRect(ctx, 105, 220, 690, 150, 22, "#f9fafb", "#e5e7eb");

      ctx.fillStyle = "#111827";
      ctx.font = "bold 38px Arial";
      ctx.fillText(slot.building_name || slot.building_id || "Building", 450, 275);

      ctx.font = "bold 62px Arial";
      ctx.fillText(`Slot ${slot.slot_id}`, 450, 345);

      ctx.fillStyle = "#6b7280";
      ctx.font = "24px Arial";
      ctx.fillText(`Floor: ${slot.floor || "—"}   Zone: ${slot.zone || "—"}`, 450, 405);

      roundRect(ctx, 155, 445, 590, 590, 30, "#ffffff", "#d1d5db");

      const qrDataUrl = await QRCode.toDataURL(qrValue, {
        width: 520,
        margin: 2,
        errorCorrectionLevel: "H",
        color: {
          dark: "#111827",
          light: "#ffffff",
        },
      });

      await drawImageOnCanvas(ctx, qrDataUrl, 190, 480, 520, 520);

      ctx.fillStyle = "#111827";
      ctx.font = "bold 27px Arial";
      ctx.fillText("Manual WhatsApp Command", 450, 1085);

      ctx.fillStyle = "#374151";
      ctx.font = "22px Arial";
      wrapText(ctx, manualCommand, 450, 1130, 760, 32);

      ctx.fillStyle = "#6b7280";
      ctx.font = "20px Arial";
      ctx.fillText("Use only if QR scan does not open WhatsApp.", 450, 1210);

      const link = document.createElement("a");
      link.download = `Juicer_QR_${slot.building_id}_${slot.slot_id}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();

      setSuccess("QR downloaded successfully.");
    } catch (err) {
      console.error(err);
      setError("Could not download QR image.");
    }
  }

  return (
    <div className="app-container">
      <div className="toast-container">
        {success && (
          <div className="toast success-toast">
            <span className="toast-icon">✅</span>
            <div className="toast-content">{success}</div>
            <button className="toast-close" onClick={() => setSuccess("")}>×</button>
          </div>
        )}
        {error && (
          <div className="toast error-toast">
            <span className="toast-icon">❌</span>
            <div className="toast-content">{error}</div>
            <button className="toast-close" onClick={() => setError("")}>×</button>
          </div>
        )}
      </div>

      <header className="topbar">
        <div className="logo-group">
          <span className="logo-icon">⚡</span>
          <span className="logo-text">Juicer Admin Dashboard</span>
        </div>
        <div className="topbar-actions">
          <button className="refresh-btn" onClick={refreshAll}>Refresh</button>
          <button className="logout-btn" onClick={() => alert("Logged out")}>Logout</button>
        </div>
      </header>

      <div className="app-wrapper">
        <aside className="sidebar">
          <h2 className="sidebar-title">Admin Menu</h2>
          
          <div className="sidebar-group">
            <div className="group-title">Operations</div>
            <ul className="group-list">
              <li 
                className={`group-item ${activeTab === "dashboard" ? "active" : ""}`}
                onClick={() => setActiveTab("dashboard")}
              >
                Live Dashboard
              </li>
              <li 
                className={`group-item ${activeTab === "chargers" ? "active" : ""}`}
                onClick={() => setActiveTab("chargers")}
              >
                Chargers Status
              </li>
              <li 
                className={`group-item ${activeTab === "juicers" ? "active" : ""}`}
                onClick={() => setActiveTab("juicers")}
              >
                Field Operators
              </li>
              <li 
                className={`group-item ${activeTab === "sessions" ? "active" : ""}`}
                onClick={() => setActiveTab("sessions")}
              >
                Charging Sessions
              </li>
              <li 
                className={`group-item ${activeTab === "jobs" ? "active" : ""}`}
                onClick={() => setActiveTab("jobs")}
              >
                Jobs History
              </li>
            </ul>
          </div>

          <div className="sidebar-group">
            <div className="group-title">Infrastructure</div>
            <ul className="group-list">
              <li 
                className={`group-item ${activeTab === "qr-management" ? "active" : ""}`}
                onClick={() => setActiveTab("qr-management")}
              >
                Building &amp; QR Codes
              </li>
            </ul>
          </div>
        </aside>

        <main className="content-area">

          {loading ? (
            <div className="loading-state">Loading dashboard...</div>
          ) : (
            <>
              {activeTab === "dashboard" && (
                <>
                  <div className="content-header">
                    <nav className="breadcrumbs">JUICER ADMIN &gt; Live Dashboard</nav>
                    <h1 className="content-title">Operations Dashboard</h1>
                    <p className="content-subtitle">Live overview of active queues and performance metrics.</p>
                  </div>

                  <section className="metrics">
                    <Metric title="Total Jobs" value={stats.total} />
                    <Metric title="Active Queue" value={stats.active} />
                    <Metric title="Charging" value={stats.charging} />
                    <Metric title="Completed" value={stats.completed} />
                    <Metric title="Stop Requests" value={stats.stopped} />
                  </section>

                  <Panel title="Live Operations Status" description="Real-time status of active jobs in the queue. Auto-refresh: 10s">
                    <div className="table">
                      <div className="table-head jobs-grid">
                        <span>Job</span>
                        <span>Vehicle</span>
                        <span>Customer</span>
                        <span>Building / Slot</span>
                        <span>Status</span>
                        <span>Created</span>
                      </div>

                      {jobs.filter(job => ACTIVE_STEPS.includes(job.current_step)).length === 0 ? (
                        <div className="empty">No active jobs in queue.</div>
                      ) : (
                        jobs.filter(job => ACTIVE_STEPS.includes(job.current_step)).map((job) => (
                          <div className="table-row jobs-grid job-row" key={job.job_id}>
                            <div className="job-id-cell">
                              <strong>{job.job_id ? `#${job.job_id.slice(0, 8)}` : "—"}</strong>
                              <small>{job.job_id || "No job ID"}</small>
                            </div>

                            <div className="vehicle-cell">
                              <strong>{job.vehicle_number || "Pending"}</strong>
                              <small>Vehicle Number</small>
                            </div>

                            <div className="customer-cell">
                              <strong>{job.phone_number || job.phone || "—"}</strong>
                              <small>WhatsApp Customer</small>
                            </div>

                            <div className="location-cell">
                              <strong>{getJobBuildingName(job)}</strong>
                              <small>Slot {job.slot_id || "—"}</small>
                            </div>

                            <Badge value={job.current_step || "UNKNOWN"} />

                            <div className="date-cell">
                              <strong>{formatDate(job.created_at || job.updated_at)}</strong>
                              <small>{job.updated_at ? `Updated ${formatDate(job.updated_at)}` : ""}</small>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </Panel>
                </>
              )}

              {activeTab === "chargers" && (
                <>
                  <div className="content-header">
                    <nav className="breadcrumbs">JUICER ADMIN &gt; Chargers</nav>
                    <h1 className="content-title">Chargers Status</h1>
                    <p className="content-subtitle">Maintain charger health and current utilization.</p>
                  </div>

                  <Panel title="Charger Status Log" description="Active utilization details for all charging points.">
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
                </>
              )}

              {activeTab === "juicers" && (
                <>
                  <div className="content-header">
                    <nav className="breadcrumbs">JUICER ADMIN &gt; Operators</nav>
                    <h1 className="content-title">Field Operators</h1>
                    <p className="content-subtitle">Track field operator availability and active assignments.</p>
                  </div>

                  <Panel title="Juicer Operator Availability" description="Track realtime status and assignments for field operators.">
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
                </>
              )}

              {activeTab === "jobs" && (
                <>
                  <div className="content-header">
                    <nav className="breadcrumbs">JUICER ADMIN &gt; Jobs History</nav>
                    <h1 className="content-title">Jobs History</h1>
                    <p className="content-subtitle">Search and filter historic charging request logs.</p>
                  </div>

                  <Panel title="Recent Jobs Database" description="Complete logs of all sessions and charging requests.">
                    <div className="job-filter-panel">
                      <div className="filter-block search-block">
                        <label>Search Jobs</label>
                        <input
                          value={jobSearch}
                          onChange={(e) => setJobSearch(e.target.value)}
                          placeholder="Search vehicle, phone, slot, job ID, building..."
                        />
                      </div>

                      <div className="filter-block">
                        <label>Status</label>
                        <select value={jobStatusFilter} onChange={(e) => setJobStatusFilter(e.target.value)}>
                          <option value="ALL">All Statuses</option>
                          {jobStatusOptions.map((status) => (
                            <option key={status} value={status}>{status}</option>
                          ))}
                        </select>
                      </div>

                      <div className="filter-block">
                        <label>Building</label>
                        <select value={jobBuildingFilter} onChange={(e) => setJobBuildingFilter(e.target.value)}>
                          <option value="ALL">All Buildings</option>
                          {jobBuildingOptions.map((building) => (
                            <option key={building.id} value={building.id}>{building.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="filter-block date-block">
                        <label>From Date</label>
                        <input
                          type="date"
                          value={jobFromDate}
                          onChange={(e) => setJobFromDate(e.target.value)}
                        />
                      </div>

                      <div className="filter-block date-block">
                        <label>To Date</label>
                        <input
                          type="date"
                          value={jobToDate}
                          onChange={(e) => setJobToDate(e.target.value)}
                        />
                      </div>

                      <button className="primary-btn clear-filter-btn" onClick={clearJobFilters}>Clear Filters</button>
                    </div>

                    <div className="filter-summary">
                      Showing <b>{recentJobs.length}</b> of <b>{filteredJobs.length}</b> matching jobs
                      {filteredJobs.length > recentJobs.length ? " (latest 25 shown)" : ""}.
                    </div>

                    <div className="jobs-table-card">
                      <div className="table-head jobs-grid">
                        <span>Job</span>
                        <span>Vehicle</span>
                        <span>Customer</span>
                        <span>Building / Slot</span>
                        <span>Status</span>
                        <span>Created</span>
                      </div>

                      {recentJobs.length === 0 ? (
                        <div className="empty">No jobs match your search or filters.</div>
                      ) : (
                        recentJobs.map((job) => (
                          <div className="table-row jobs-grid job-row" key={job.job_id}>
                            <div className="job-id-cell">
                              <strong>{job.job_id ? `#${job.job_id.slice(0, 8)}` : "—"}</strong>
                              <small>{job.job_id || "No job ID"}</small>
                            </div>

                            <div className="vehicle-cell">
                              <strong>{job.vehicle_number || "Pending"}</strong>
                              <small>Vehicle Number</small>
                            </div>

                            <div className="customer-cell">
                              <strong>{job.phone_number || job.phone || "—"}</strong>
                              <small>WhatsApp Customer</small>
                            </div>

                            <div className="location-cell">
                              <strong>{getJobBuildingName(job)}</strong>
                              <small>Slot {job.slot_id || "—"}</small>
                            </div>

                            <Badge value={job.current_step || "UNKNOWN"} />

                            <div className="date-cell">
                              <strong>{formatDate(job.created_at || job.updated_at)}</strong>
                              <small>{job.updated_at ? `Updated ${formatDate(job.updated_at)}` : ""}</small>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </Panel>
                </>
              )}

              {activeTab === "sessions" && (
                <>
                  <div className="content-header">
                    <nav className="breadcrumbs">JUICER ADMIN &gt; Sessions</nav>
                    <h1 className="content-title">Sessions</h1>
                    <p className="content-subtitle">Track and filter historic and active vehicle charging sessions.</p>
                  </div>

                  <form className="sessions-filter-bar" onSubmit={handleSessFilter}>
                    <div className="filter-field">
                      <label htmlFor="sess-building">Building</label>
                      <select
                        id="sess-building"
                        value={sessBuildingFilter}
                        onChange={(e) => setSessBuildingFilter(e.target.value)}
                      >
                        <option value="ALL">All Buildings</option>
                        {buildings.map((building) => (
                          <option key={building.building_id} value={building.building_id}>
                            {building.building_name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="filter-field">
                      <label htmlFor="sess-slot">Slot ID</label>
                      <input
                        id="sess-slot"
                        type="text"
                        value={sessSlotSearch}
                        onChange={(e) => setSessSlotSearch(e.target.value)}
                        placeholder="e.g. A101"
                      />
                    </div>
                    <div className="filter-field">
                      <label htmlFor="sess-vehicle">Vehicle Number</label>
                      <input
                        id="sess-vehicle"
                        type="text"
                        value={sessVehicleSearch}
                        onChange={(e) => setSessVehicleSearch(e.target.value)}
                        placeholder="e.g. MH12AB1234"
                      />
                    </div>
                    <div className="filter-field">
                      <label htmlFor="sess-phone">Customer Phone</label>
                      <input
                        id="sess-phone"
                        type="text"
                        value={sessPhoneSearch}
                        onChange={(e) => setSessPhoneSearch(e.target.value)}
                        placeholder="e.g. 9876543210"
                      />
                    </div>
                    <div className="filter-field">
                      <label htmlFor="sess-status">Status</label>
                      <select
                        id="sess-status"
                        value={sessStatusFilter}
                        onChange={(e) => setSessStatusFilter(e.target.value)}
                      >
                        <option value="ALL">All Statuses</option>
                        <option value="ACTIVE">All Active Sessions</option>
                        <option value="ASSIGNED">Assigned</option>
                        <option value="ENROUTE">Enroute</option>
                        <option value="CHARGING">Charging</option>
                        <option value="STOP_REQUESTED">Stop Requested</option>
                        <option value="COMPLETED">Completed</option>
                      </select>
                    </div>
                    <div className="filter-actions">
                      <button type="submit" className="primary-btn">Filter</button>
                      <button type="button" className="secondary-btn" onClick={handleSessReset}>Reset</button>
                    </div>
                  </form>

                  <Panel title="Charging Sessions Database" description={`Showing ${filteredSessions.length} sessions.`}>
                    <div className="table-wrapper">
                      <div className="table">
                        <div className="table-head sessions-grid">
                          <span>Session ID</span>
                          <span>Station</span>
                          <span>User</span>
                          <span>Vehicle</span>
                          <span>Start</span>
                          <span>End</span>
                          <span>Energy (kWh)</span>
                          <span>Cost</span>
                          <span>Status</span>
                          <span>Actions</span>
                        </div>

                        {filteredSessions.length === 0 ? (
                          <div className="empty" style={{ gridColumn: "span 10", textAlign: "center", padding: "32px" }}>
                            No sessions found.
                          </div>
                        ) : (
                          filteredSessions.map((job) => {
                            const isJobActive = ACTIVE_STEPS.includes(job.current_step);
                            
                            const energy = Number(job.energy_kwh || 0);
                            const cost = Number(job.cost || energy * 15.0);

                            return (
                              <div className="table-row sessions-grid" key={job.job_id}>
                                <div className="job-id-cell">
                                  <strong>#{job.job_id.slice(0, 8)}</strong>
                                  <small>{job.job_id.slice(8, 16)}...</small>
                                </div>
                                <div className="location-cell">
                                  <strong>{job.building_name || job.building_id || "Building"}</strong>
                                  <small>Slot {job.slot_id}</small>
                                </div>
                                <strong>{job.phone_number || "—"}</strong>
                                <strong>{job.vehicle_number || "Pending"}</strong>
                                <span>{formatDate(job.created_at)}</span>
                                <span>{job.current_step === "COMPLETED" ? formatDate(job.updated_at) : "—"}</span>
                                <span>{energy.toFixed(2)}</span>
                                <span>₹{cost.toFixed(2)}</span>
                                <Badge value={isJobActive ? "Active" : "Completed"} />
                                <div className="filter-actions" style={{ height: "auto" }}>
                                  {isJobActive ? (
                                    <button 
                                      className="danger-btn" 
                                      style={{ padding: "4px 8px", fontSize: "11px", height: "auto" }}
                                      onClick={() => {
                                        if (window.confirm("Complete this charging session manually?")) {
                                          api.post(`/juicer/jobs/${job.job_id}/complete`)
                                            .then(() => {
                                              alert("Session stopped.");
                                              refreshAll();
                                            })
                                            .catch(err => alert("Failed to complete job: " + (err.response?.data?.detail || err.message)));
                                        }
                                      }}
                                    >
                                      Stop
                                    </button>
                                  ) : (
                                    <button 
                                      className="secondary-btn" 
                                      style={{ padding: "4px 8px", fontSize: "11px", height: "auto" }}
                                      onClick={() => alert(`Session details for ${job.job_id}:\nBuilding: ${job.building_name || job.building_id}\nSlot: ${job.slot_id}\nEnergy: ${energy.toFixed(2)} kWh\nTotal Cost: ₹${cost.toFixed(2)}`)}
                                    >
                                      Receipt
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </Panel>
                </>
              )}

              {activeTab === "qr-management" && (
                <>
                  <div className="content-header">
                    <nav className="breadcrumbs">JUICER ADMIN &gt; Building &amp; QR Codes</nav>
                    <h1 className="content-title">Building Parking QR Management</h1>
                    <p className="content-subtitle">Create buildings and generate secure WhatsApp QR codes for parking slots.</p>
                  </div>

                  <Panel title="Building &amp; Slots Configuration" description="Create buildings, then generate secure QR codes for each parking slot inside that building.">
                    <section className="qr-admin-grid">
                      <form className="form-card" onSubmit={handleCreateBuilding}>
                        <h3>Create Building</h3>
                        <label className="field-label">Building Name</label>
                        <input
                          value={buildingForm.building_name}
                          onChange={(e) => setBuildingForm({ ...buildingForm, building_name: e.target.value })}
                          placeholder="Building Name, e.g. Green Heights"
                        />
                        <label className="field-label">Building ID</label>
                        <input
                          value={autoBuildingId}
                          readOnly
                          disabled
                          className="locked-input"
                          placeholder="Auto-generated from building name"
                        />
                        <small className="field-hint">Locked. This ID is generated automatically and kept unique.</small>
                        <select
                          value={buildingForm.building_type}
                          onChange={(e) => setBuildingForm({ ...buildingForm, building_type: e.target.value })}
                        >
                          <option>Residential</option>
                          <option>Corporate</option>
                          <option>Mall</option>
                          <option>Hospital</option>
                          <option>Hotel</option>
                          <option>Campus</option>
                          <option>Other</option>
                        </select>
                        <input
                          value={buildingForm.address}
                          onChange={(e) => setBuildingForm({ ...buildingForm, address: e.target.value })}
                          placeholder="Address optional"
                        />
                        <button type="submit" className="primary-btn">Create Building</button>
                      </form>

                      <form className="form-card" onSubmit={handleCreateSlot}>
                        <h3>Create Slot QR</h3>
                        <select value={selectedBuildingId} onChange={(e) => setSelectedBuildingId(e.target.value)}>
                          <option value="">Select Building</option>
                          {buildings.map((building) => (
                            <option key={building.building_id} value={building.building_id}>
                              {building.building_name} - {building.building_id}
                            </option>
                          ))}
                        </select>
                        <input
                          value={slotForm.slot_id}
                          onChange={(e) => setSlotForm({ ...slotForm, slot_id: e.target.value })}
                          placeholder="Slot ID, e.g. A101"
                        />
                        <input
                          value={slotForm.floor}
                          onChange={(e) => setSlotForm({ ...slotForm, floor: e.target.value })}
                          placeholder="Floor, e.g. B1"
                        />
                        <input
                          value={slotForm.zone}
                          onChange={(e) => setSlotForm({ ...slotForm, zone: e.target.value })}
                          placeholder="Zone, e.g. North Wing"
                        />
                        <button type="submit" className="primary-btn">Generate Slot QR</button>
                      </form>
                    </section>

                    <div className="building-tabs">
                      {buildings.length === 0 ? (
                        <span className="muted">No buildings created yet.</span>
                      ) : (
                        buildings.map((building) => (
                          <button
                            key={building.building_id}
                            className={building.building_id === selectedBuildingId ? "tab active-tab" : "tab"}
                            onClick={() => setSelectedBuildingId(building.building_id)}
                          >
                            <span>{building.building_name}</span>
                            <small>{building.building_id}</small>
                          </button>
                        ))
                      )}
                    </div>

                    {slotLoading ? (
                      <div className="loading">Loading slots...</div>
                    ) : slots.length === 0 ? (
                      <div className="empty">No parking slots found for this building.</div>
                    ) : (
                      <div className="qr-grid">
                        {slots.map((slot) => (
                          <article className="qr-card" key={slot.parking_slot_id}>
                            <div className="qr-card-head">
                              <div>
                                <h3>{slot.slot_id}</h3>
                                <p>{slot.building_name}</p>
                              </div>
                              <Badge value={slot.is_active ? "ACTIVE" : "INACTIVE"} />
                            </div>

                            <img src={getQrImageUrl(slot)} alt={`QR for ${slot.slot_id}`} className="qr-image" />

                            <div className="slot-meta">
                              <span><b>Floor:</b> {slot.floor || "—"}</span>
                              <span><b>Zone:</b> {slot.zone || "—"}</span>
                              <span><b>Token:</b> {slot.qr_token.slice(0, 12)}...</span>
                            </div>

                            <div className="manual-command-box">
                              <b>Manual Command:</b>
                              <span>{getManualCommand(slot)}</span>
                            </div>

                            <div className="qr-actions">
                              <button className="primary-btn" onClick={() => downloadQrCard(slot)}>Download QR</button>
                              <a href={slot.qr_link} target="_blank" rel="noreferrer" className="secondary-btn">Open QR Link</a>
                              <button className="secondary-btn" onClick={() => copyText(slot.qr_link)}>Copy Link</button>
                              <button className="secondary-btn" onClick={() => copyText(getManualCommand(slot))}>Copy Manual Command</button>
                              <button className="secondary-btn" onClick={() => regenerateSlot(slot.parking_slot_id)}>Regenerate</button>
                              <button className="secondary-btn" onClick={() => toggleSlot(slot.parking_slot_id)}>
                                {slot.is_active ? "Deactivate" : "Activate"}
                              </button>
                              <button className="danger-btn" onClick={() => deleteSlot(slot.parking_slot_id)}>Delete</button>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </Panel>
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function generateUniqueBuildingId(name, existingIds) {
  const base = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28);

  if (!base) return "";

  let candidate = base;
  let counter = 2;

  while (existingIds.has(candidate)) {
    const suffix = `_${counter}`;
    candidate = `${base.slice(0, 32 - suffix.length)}${suffix}`;
    counter += 1;
  }

  return candidate;
}

function getJobBuildingName(job) {
  return job.building_name || job.building_id || "Unassigned Building";
}

function parseDateAsUtcIfNaive(value) {
  if (!value) return new Date("");

  let normalizedValue = String(value);

  if (
    normalizedValue.includes("T") &&
    !normalizedValue.endsWith("Z") &&
    !normalizedValue.includes("+")
  ) {
    normalizedValue = `${normalizedValue}Z`;
  }

  return new Date(normalizedValue);
}

function formatDate(value) {
  if (!value) return "—";

  try {
    const date = parseDateAsUtcIfNaive(value);

    if (isNaN(date.getTime())) {
      return "—";
    }

    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(date);
  } catch (error) {
    console.error("Date format error:", error);
    return "—";
  }
}

function drawImageOnCanvas(ctx, imageSrc, x, y, width, height) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      ctx.drawImage(image, x, y, width, height);
      resolve();
    };
    image.onerror = reject;
    image.src = imageSrc;
  });
}

function roundRect(ctx, x, y, width, height, radius, fillStyle, strokeStyle) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();

  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }

  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const chunks = text.split("_");
  let line = "";

  for (let i = 0; i < chunks.length; i += 1) {
    const testLine = line ? `${line}_${chunks[i]}` : chunks[i];
    const metrics = ctx.measureText(testLine);

    if (metrics.width > maxWidth && i > 0) {
      ctx.fillText(line, x, y);
      line = chunks[i];
      y += lineHeight;
    } else {
      line = testLine;
    }
  }

  ctx.fillText(line, x, y);
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
