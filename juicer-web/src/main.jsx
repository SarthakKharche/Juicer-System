import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api/client";
import notificationSound from "../notification_o14egLP.mp3";
import "./style.css";

function App() {
  const [jobs, setJobs] = useState([]);
  const [buildings, setBuildings] = useState([]);
  const [selectedBuildingId, setSelectedBuildingId] = useState("");
  const [buildingSearch, setBuildingSearch] = useState("");
  const [buildingDropdownOpen, setBuildingDropdownOpen] = useState(false);
  const [operator, setOperator] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("juicer_operator_session") || "null");
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const googleButtonRef = useRef(null);
  const knownJobsRef = useRef(new Map());
  const hasLoadedJobsRef = useRef(false);
  const alertAudioRef = useRef(null);
  const alertsEnabledRef = useRef(true);
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  async function loadBuildings() {
    try {
      const res = await api.get("/admin/buildings");
      const data = Array.isArray(res.data) ? res.data.filter((building) => building.is_active) : [];
      setBuildings(data);

      if (!selectedBuildingId && data.length > 0) {
        setSelectedBuildingId(data[0].building_id);
      }
    } catch (err) {
      console.error(err);
      setError("Could not load buildings.");
    }
  }

  async function loadJobs() {
    if (!operator?.building_id) return;

    try {
      setError("");
      const res = await api.get("/juicer/jobs", {
        params: { building_id: operator.building_id },
      });
      notifyForJobChanges(res.data);
      setJobs(res.data);
    } catch (err) {
      console.error(err);
      setError("Could not load jobs from backend.");
    } finally {
      setLoading(false);
    }
  }

  async function updateJob(jobId, action) {
    try {
      setActionLoading(`${jobId}-${action}`);
      setError("");
      setSuccess("");

      const body =
        action === "plugged-in"
          ? {
              charger_id: jobById(jobs, jobId)?.slot_id || "CHARGER_001",
            }
          : {};

      await api.post(`/juicer/jobs/${jobId}/${action}`, body);
      setSuccess(`Job status updated successfully to ${action.toUpperCase()}!`);
      await loadJobs();
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.detail || "Action failed.");
    } finally {
      setActionLoading("");
    }
  }

  useEffect(() => {
    loadBuildings().finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (!operator) return;

    loadJobs();
    const interval = setInterval(loadJobs, 5000);
    return () => clearInterval(interval);
  }, [operator]);

  useEffect(() => {
    if (!googleClientId || operator || !selectedBuildingId) return;

    function initializeGoogle() {
      if (!window.google || !googleButtonRef.current) return;
      googleButtonRef.current.innerHTML = "";

      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: handleGoogleCredential,
      });

      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: "outline",
        size: "large",
        text: "signin_with",
        shape: "rectangular",
        width: 320,
      });
    }

    if (window.google) {
      initializeGoogle();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = initializeGoogle;
    document.body.appendChild(script);

    return () => {
      script.onload = null;
    };
  }, [googleClientId, operator, selectedBuildingId]);

  useEffect(() => {
    alertsEnabledRef.current = alertsEnabled;
  }, [alertsEnabled]);

  useEffect(() => {
    alertAudioRef.current = new Audio(notificationSound);
    alertAudioRef.current.preload = "auto";
    alertAudioRef.current.volume = 1;
  }, []);

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

  const queueJobs = useMemo(() => {
    return jobs
      .filter((job) => job.building_id === operator?.building_id)
      .filter((job) =>
        ["ASSIGNED", "ENROUTE", "CHARGING", "STOP_REQUESTED"].includes(
          job.current_step
        )
      )
      .sort(
        (a, b) =>
          new Date(a.created_at || a.updated_at) -
          new Date(b.created_at || b.updated_at)
      );
  }, [jobs, operator?.building_id]);

  const hasActiveJob = queueJobs.some((job) =>
    ["ENROUTE", "CHARGING", "STOP_REQUESTED"].includes(job.current_step)
  );

  const firstAssignedJob = queueJobs.find(
    (job) => job.current_step === "ASSIGNED"
  );

  function handleGoogleCredential(response) {
    if (!selectedBuildingId) {
      setError("Select a building before signing in.");
      return;
    }

    const profile = parseJwt(response.credential);
    const building = buildings.find((item) => item.building_id === selectedBuildingId);
    const session = {
      email: profile.email,
      name: profile.name || profile.email,
      picture: profile.picture,
      building_id: selectedBuildingId,
      building_name: building?.building_name || selectedBuildingId,
    };

    localStorage.setItem("juicer_operator_session", JSON.stringify(session));
    setOperator(session);
    setSuccess(`Signed in for ${session.building_name}.`);
  }

  function logout() {
    localStorage.removeItem("juicer_operator_session");
    setOperator(null);
    setJobs([]);
    knownJobsRef.current = new Map();
    hasLoadedJobsRef.current = false;
    setLoading(false);
  }

  function enableAlerts() {
    setAlertsEnabled(true);
    playAlertSound();
    vibrate([60]);
    setSuccess("Operator alerts enabled.");
  }

  function notifyForJobChanges(nextJobs) {
    const nextMap = new Map(nextJobs.map((job) => [job.job_id, job]));
    const previousMap = knownJobsRef.current;

    if (!hasLoadedJobsRef.current) {
      knownJobsRef.current = nextMap;
      hasLoadedJobsRef.current = true;
      return;
    }

    const newJobs = nextJobs.filter((job) => !previousMap.has(job.job_id));
    const stopRequests = nextJobs.filter((job) => {
      const previous = previousMap.get(job.job_id);
      return previous && previous.current_step !== "STOP_REQUESTED" && job.current_step === "STOP_REQUESTED";
    });

    if (newJobs.length > 0) {
      sendOperatorAlert("new-job");
      setSuccess(`New charging request received for slot ${newJobs[0].slot_id}.`);
    }

    if (stopRequests.length > 0) {
      sendOperatorAlert("stop-request");
      setSuccess(`Stop request received for slot ${stopRequests[0].slot_id}.`);
    }

    knownJobsRef.current = nextMap;
  }

  function sendOperatorAlert(type) {
    if (alertsEnabledRef.current) {
      playAlertSound();
    }

    vibrate(type === "stop-request" ? [180, 80, 180] : [140, 70, 140]);
  }

  function playAlertSound() {
    const audio = alertAudioRef.current || new Audio(notificationSound);
    audio.pause();
    audio.currentTime = 0;
    audio.play().catch(() => {
      setSuccess("Tap Test Alert once to allow notification sound.");
    });
  }

  function vibrate(pattern) {
    if ("vibrate" in navigator) {
      navigator.vibrate(pattern);
    }
  }

  if (!operator) {
    return (
      <LoginScreen
        authLoading={authLoading}
        buildings={buildings}
        selectedBuildingId={selectedBuildingId}
        setSelectedBuildingId={setSelectedBuildingId}
        buildingSearch={buildingSearch}
        setBuildingSearch={setBuildingSearch}
        buildingDropdownOpen={buildingDropdownOpen}
        setBuildingDropdownOpen={setBuildingDropdownOpen}
        googleButtonRef={googleButtonRef}
        googleClientId={googleClientId}
        error={error}
      />
    );
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
          <button className="hamburger-btn" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle Menu">
            <span className="hamburger-bar"></span>
            <span className="hamburger-bar"></span>
            <span className="hamburger-bar"></span>
          </button>
          <span className="logo-icon">⚡</span>
          <span className="logo-text">Juicer Operator Dashboard</span>
        </div>
        <div className="topbar-actions">
          <div className="operator-chip">
            {operator.picture && <img src={operator.picture} alt="" />}
            <div>
              <strong>{operator.name}</strong>
              <span>{operator.building_name}</span>
            </div>
          </div>
          <button
            className={`refresh-btn alert-toggle ${alertsEnabled ? "enabled" : ""}`}
            onClick={enableAlerts}
          >
            {alertsEnabled ? "Test Alert" : "Enable Alerts"}
          </button>
          <button className="refresh-btn" onClick={loadJobs}>
            Refresh
          </button>
          <button className="refresh-btn" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)}></div>
      )}

      <div className="app-wrapper">
        <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
          <h2 className="sidebar-title">Operator Menu</h2>
          
          <div className="sidebar-group">
            <div className="group-title">Operations</div>
            <ul className="group-list">
              <li className="group-item active" onClick={() => setSidebarOpen(false)}>
                Active Queue
              </li>
            </ul>
          </div>
        </aside>

        <main className="content-area">
          <div className="content-header">
            <nav className="breadcrumbs">JUICER OPERATOR &gt; Active Queue</nav>
            <h1 className="content-title">Operator Dashboard</h1>
            <p className="content-subtitle">
              Strict first come, first serve queue for {operator.building_name}.
              Only the top job can be accepted.
            </p>
          </div>

          {loading ? (
            <div className="loading-state">Loading active queue...</div>
          ) : (
            <>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Active Queue</h2>
                    <p>Strict FCFS queue management. Auto-refresh: 5s</p>
                  </div>
                </div>

                <div className="column-body">
                  {queueJobs.length === 0 ? (
                    <p className="empty-column">No active queue jobs</p>
                  ) : (
                    queueJobs.map((job, index) => (
                      <JobCard
                        key={job.job_id}
                        job={job}
                        queuePosition={index + 1}
                        hasActiveJob={hasActiveJob}
                        firstAssignedJob={firstAssignedJob}
                        actionLoading={actionLoading}
                        updateJob={updateJob}
                      />
                    ))
                  )}
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function LoginScreen({
  authLoading,
  buildings,
  selectedBuildingId,
  setSelectedBuildingId,
  buildingSearch,
  setBuildingSearch,
  buildingDropdownOpen,
  setBuildingDropdownOpen,
  googleButtonRef,
  googleClientId,
  error,
}) {
  const selectedBuilding = buildings.find((building) => building.building_id === selectedBuildingId);
  const buildingSearchText = buildingSearch.trim().toLowerCase();
  const filteredBuildings = buildings.filter((building) => {
    const haystack = [
      building.building_name,
      building.building_id,
      building.address,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return !buildingSearchText || haystack.includes(buildingSearchText);
  });

  return (
    <main className="login-shell">
      <section className="login-layout">
        <div className="login-hero">
          <div className="login-mark">EV</div>
          <div>
            <p className="login-eyebrow">Juicer Operator</p>
            <h1>Start your charging shift</h1>
            <p>
              Access the active queue for your assigned building and manage
              charging jobs in first come, first serve order.
            </p>
          </div>

          <div className="login-status-grid">
            <div>
              <span>Queue Mode</span>
              <strong>FCFS</strong>
            </div>
            <div>
              <span>Access</span>
              <strong>Google</strong>
            </div>
            <div>
              <span>Scope</span>
              <strong>{selectedBuilding?.building_name || "Building"}</strong>
            </div>
          </div>
        </div>

        <div className="login-panel">
          <div className="login-panel-head">
            <span className="login-step">1</span>
            <div>
              <h2>Choose building</h2>
              <p>Your dashboard will show only this building's queue.</p>
            </div>
          </div>

          <label className="login-label" htmlFor="operator-building">
            Building
          </label>
          <div
            className="building-combobox"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setBuildingDropdownOpen(false);
              }
            }}
          >
            <div className="building-combobox-control">
              <input
                id="operator-building"
                className="building-search-input"
                type="search"
                value={buildingSearch}
                onChange={(event) => {
                  setBuildingSearch(event.target.value);
                  setBuildingDropdownOpen(true);
                }}
                onFocus={() => setBuildingDropdownOpen(true)}
                placeholder={
                  selectedBuilding
                    ? `Selected: ${selectedBuilding.building_name}`
                    : "Search and select building"
                }
                disabled={authLoading || buildings.length === 0}
                autoComplete="off"
              />
              <button
                type="button"
                className="building-combobox-toggle"
                onClick={() => setBuildingDropdownOpen(!buildingDropdownOpen)}
                disabled={authLoading || buildings.length === 0}
                aria-label="Toggle building list"
              >
                ▾
              </button>
            </div>

            {buildingDropdownOpen && (
              <div className="building-search-list">
                {buildings.length === 0 ? (
                  <div className="building-search-empty">No active buildings available</div>
                ) : filteredBuildings.length === 0 ? (
                  <div className="building-search-empty">No buildings match your search</div>
                ) : (
                  filteredBuildings.map((building) => (
                    <button
                      key={building.building_id}
                      type="button"
                      className={`building-option ${building.building_id === selectedBuildingId ? "selected" : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setSelectedBuildingId(building.building_id);
                        setBuildingSearch("");
                        setBuildingDropdownOpen(false);
                      }}
                    >
                      <strong>{building.building_name}</strong>
                      <span>{building.address || building.building_id}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="selected-building-card">
            <span>Selected building</span>
            <strong>{selectedBuilding?.building_name || "No building selected"}</strong>
            <small>{selectedBuilding?.address || selectedBuilding?.building_id || "Select a building to continue"}</small>
          </div>

          <div className="login-divider" />

          <div className="login-panel-head">
            <span className="login-step">2</span>
            <div>
              <h2>Sign in with Google</h2>
              <p>Use your operator account to open the queue.</p>
            </div>
          </div>

          <div className="google-login-slot">
            {googleClientId ? (
              <div ref={googleButtonRef} />
            ) : (
              <div className="login-warning">
                Add VITE_GOOGLE_CLIENT_ID to enable Google sign-in.
              </div>
            )}
          </div>

          {error && <div className="login-error">{error}</div>}
        </div>
      </section>
    </main>
  );
}

function parseJwt(token) {
  const [, payload] = token.split(".");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const decoded = window.atob(padded);

  return JSON.parse(
    decodeURIComponent(
      decoded
        .split("")
        .map((char) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join("")
    )
  );
}

function jobById(jobs, jobId) {
  return jobs.find((job) => job.job_id === jobId);
}

function JobCard({
  job,
  queuePosition,
  hasActiveJob,
  firstAssignedJob,
  actionLoading,
  updateJob,
}) {
  const shortJobId = job.job_id.slice(0, 8);

  const isFirstAssigned =
    firstAssignedJob && firstAssignedJob.job_id === job.job_id;

  const acceptDisabled =
    !isFirstAssigned ||
    hasActiveJob ||
    actionLoading === `${job.job_id}-accept`;

  return (
    <article className="job-card">
      <div className="job-card-top">
        <h3>Slot {job.slot_id}</h3>

        <span className={`badge badge-${job.current_step.toLowerCase()}`}>
          {job.current_step}
        </span>
      </div>

      <div className="queue-rank">Queue #{queuePosition}</div>

      <div className="job-info">
        <p>
          <span>Building</span>
          <strong>{job.building_name || job.building_id || "Unassigned"}</strong>
        </p>

        <p>
          <span>Vehicle</span>
          <strong>{job.vehicle_number || "Pending"}</strong>
        </p>

        <p>
          <span>Phone</span>
          <strong>{job.phone_number}</strong>
        </p>

        <p>
          <span>Job ID</span>
          <strong>{shortJobId}</strong>
        </p>
      </div>

      <div className="actions">
        {job.current_step === "ASSIGNED" && (
          <>
            <button
              onClick={() => updateJob(job.job_id, "accept")}
              disabled={acceptDisabled}
            >
              Accept Job
            </button>

            {!isFirstAssigned && (
              <p className="hint-text">Waiting for jobs ahead in queue.</p>
            )}

            {isFirstAssigned && hasActiveJob && (
              <p className="hint-text">
                Finish the active job before accepting this one.
              </p>
            )}
          </>
        )}

        {job.current_step === "ENROUTE" && (
          <button
            onClick={() => updateJob(job.job_id, "plugged-in")}
            disabled={actionLoading === `${job.job_id}-plugged-in`}
          >
            Start Charging
          </button>
        )}

        {job.current_step === "CHARGING" && (
          <button
            onClick={() => updateJob(job.job_id, "complete")}
            disabled={actionLoading === `${job.job_id}-complete`}
          >
            Complete Session
          </button>
        )}

        {job.current_step === "STOP_REQUESTED" && (
          <>
            <button
              onClick={() => updateJob(job.job_id, "complete")}
              disabled={actionLoading === `${job.job_id}-complete`}
            >
              Stop Charging & Complete
            </button>

            <p className="hint-text">Customer requested immediate stop.</p>
          </>
        )}
      </div>
    </article>
  );
}

createRoot(document.getElementById("root")).render(<App />);




