import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api/client";
import "./style.css";

function App() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState("");
  const [error, setError] = useState("");

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

      const body =
        action === "plugged-in"
          ? {
              charger_id: "CHARGER_001",
            }
          : {};

      await api.post(`/juicer/jobs/${jobId}/${action}`, body);
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

  const queueJobs = useMemo(() => {
    return jobs
      .filter((job) =>
        ["ASSIGNED", "ENROUTE", "CHARGING"].includes(job.current_step)
      )
      .sort(
        (a, b) =>
          new Date(a.created_at || a.updated_at) -
          new Date(b.created_at || b.updated_at)
      );
  }, [jobs]);

  const stats = useMemo(() => {
    return {
      total: queueJobs.length,
      assigned: queueJobs.filter((job) => job.current_step === "ASSIGNED")
        .length,
      enroute: queueJobs.filter((job) => job.current_step === "ENROUTE")
        .length,
      charging: queueJobs.filter((job) => job.current_step === "CHARGING")
        .length,
    };
  }, [queueJobs]);

  const hasActiveJob = queueJobs.some((job) =>
    ["ENROUTE", "CHARGING"].includes(job.current_step)
  );

  return (
    <main className="container">
      <header className="header">
        <div>
          <p className="eyebrow">Juicer Operations</p>
          <h1>Juicer Queue Dashboard</h1>
          <p className="subtitle">
            First come, first serve queue. Enroute and charging update inside
            the same queue card.
          </p>
        </div>

        <button className="refresh-button" onClick={loadJobs}>
          Refresh
        </button>
      </header>

      {error && <div className="error-box">{error}</div>}

      <section className="stats-grid">
        <div className="stat-card">
          <span>Active Queue</span>
          <strong>{stats.total}</strong>
        </div>

        <div className="stat-card">
          <span>Assigned</span>
          <strong>{stats.assigned}</strong>
        </div>

        <div className="stat-card">
          <span>Enroute</span>
          <strong>{stats.enroute}</strong>
        </div>

        <div className="stat-card">
          <span>Charging</span>
          <strong>{stats.charging}</strong>
        </div>
      </section>

      {loading ? (
        <p className="empty-text">Loading jobs...</p>
      ) : (
        <section className="single-queue-layout">
          <div className="column queue-column">
            <div className="column-header">
              <h2>Queue</h2>
              <span>{queueJobs.length}</span>
            </div>

            <p className="column-description">
              Live charging queue. New requests go to the end. Only one job can
              be enroute or charging at a time.
            </p>

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
                    actionLoading={actionLoading}
                    updateJob={updateJob}
                  />
                ))
              )}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

function JobCard({
  job,
  queuePosition,
  hasActiveJob,
  actionLoading,
  updateJob,
}) {
  const shortJobId = job.job_id.slice(0, 8);

  const acceptDisabled =
    hasActiveJob || actionLoading === `${job.job_id}-accept`;

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

            {hasActiveJob && (
              <p className="hint-text">
                Another job is already active. Complete it first.
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
      </div>
    </article>
  );
}

createRoot(document.getElementById("root")).render(<App />);