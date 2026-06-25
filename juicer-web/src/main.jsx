import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api/client";
import "./style.css";

function App() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  async function loadJobs() {
    try {
      setError("");
      const res = await api.get("/juicer/jobs");
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
              charger_id: "CHARGER_001",
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
    loadJobs();
    const interval = setInterval(loadJobs, 5000);
    return () => clearInterval(interval);
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
  }, [jobs]);

  const hasActiveJob = queueJobs.some((job) =>
    ["ENROUTE", "CHARGING", "STOP_REQUESTED"].includes(job.current_step)
  );

  const firstAssignedJob = queueJobs.find(
    (job) => job.current_step === "ASSIGNED"
  );

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
          <button className="refresh-btn" onClick={loadJobs}>
            Refresh
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
              Strict first come, first serve queue. Only the top job can be
              accepted.
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