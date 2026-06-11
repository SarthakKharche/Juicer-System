import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api/client";
import "./style.css";

const STATUSES = [
  {
    key: "INITIATED",
    title: "Payment Pending",
    description: "Customer created request but has not paid yet.",
  },
  {
    key: "ASSIGNED",
    title: "Assigned",
    description: "Payment done. First come, first serve queue.",
  },
  {
    key: "ENROUTE",
    title: "Enroute",
    description: "Juicer accepted and is going to the slot.",
  },
  {
    key: "CHARGING",
    title: "Charging",
    description: "Vehicle is plugged in and charging.",
  },
  {
    key: "COMPLETED",
    title: "Completed",
    description: "Recently completed sessions.",
  },
];

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

  const stats = useMemo(() => {
    return {
      total: jobs.length,
      initiated: jobs.filter((job) => job.current_step === "INITIATED").length,
      assigned: jobs.filter((job) => job.current_step === "ASSIGNED").length,
      enroute: jobs.filter((job) => job.current_step === "ENROUTE").length,
      charging: jobs.filter((job) => job.current_step === "CHARGING").length,
      completed: jobs.filter((job) => job.current_step === "COMPLETED").length,
    };
  }, [jobs]);

  function jobsByStatus(status) {
    const filtered = jobs.filter((job) => job.current_step === status);

    if (status === "COMPLETED") {
      return filtered.sort(
        (a, b) => new Date(b.created_at || b.updated_at) - new Date(a.created_at || a.updated_at)
      );
    }

    return filtered.sort(
      (a, b) => new Date(a.created_at || a.updated_at) - new Date(b.created_at || b.updated_at)
    );
  }

  return (
    <main className="container">
      <header className="header">
        <div>
          <p className="eyebrow">Juicer Operations</p>
          <h1>Juicer Job Dashboard</h1>
          <p className="subtitle">
            Live first-come-first-serve dispatch queue.
          </p>
        </div>

        <button className="refresh-button" onClick={loadJobs}>
          Refresh
        </button>
      </header>

      {error && <div className="error-box">{error}</div>}

      <section className="stats-grid">
        <div className="stat-card">
          <span>Total Jobs</span>
          <strong>{stats.total}</strong>
        </div>
        <div className="stat-card">
          <span>Payment Pending</span>
          <strong>{stats.initiated}</strong>
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
        <div className="stat-card">
          <span>Completed</span>
          <strong>{stats.completed}</strong>
        </div>
      </section>

      {loading ? (
        <p className="empty-text">Loading jobs...</p>
      ) : (
        <section className="kanban">
          {STATUSES.map((status) => {
            const statusJobs = jobsByStatus(status.key);

            return (
              <div className="column" key={status.key}>
                <div className="column-header">
                  <h2>{status.title}</h2>
                  <span>{statusJobs.length}</span>
                </div>

                <p className="column-description">{status.description}</p>

                <div className="column-body">
                  {statusJobs.length === 0 ? (
                    <p className="empty-column">No jobs</p>
                  ) : (
                    statusJobs.map((job, index) => (
                      <JobCard
                        key={job.job_id}
                        job={job}
                        queuePosition={index + 1}
                        actionLoading={actionLoading}
                        updateJob={updateJob}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </main>
  );
}

function JobCard({ job, queuePosition, actionLoading, updateJob }) {
  const shortJobId = job.job_id.slice(0, 8);

  return (
    <article className="job-card">
      <div className="job-card-top">
        <h3>Slot {job.slot_id}</h3>
        <span className={`badge badge-${job.current_step.toLowerCase()}`}>
          {job.current_step}
        </span>
      </div>

      {job.current_step !== "COMPLETED" && (
        <div className="queue-rank">Queue #{queuePosition}</div>
      )}

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
          <button
            onClick={() => updateJob(job.job_id, "accept")}
            disabled={actionLoading === `${job.job_id}-accept`}
          >
            Accept Job
          </button>
        )}

        {job.current_step === "ENROUTE" && (
          <button
            onClick={() => updateJob(job.job_id, "plugged-in")}
            disabled={actionLoading === `${job.job_id}-plugged-in`}
          >
            Mark Plugged In
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

        {job.current_step === "INITIATED" && (
          <p className="hint-text">Waiting for customer payment.</p>
        )}

        {job.current_step === "COMPLETED" && (
          <p className="hint-text">Session closed.</p>
        )}
      </div>
    </article>
  );
}

createRoot(document.getElementById("root")).render(<App />);