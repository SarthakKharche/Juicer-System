import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api/client";
import "./style.css";

const ACTIVE_STEPS = ["ASSIGNED", "ENROUTE", "CHARGING", "STOP_REQUESTED"];

function App() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
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

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Company Console</p>
          <h1>Juicer Admin Dashboard</h1>
          <p className="subtitle">Analyse operations, monitor chargers, and manage field juicers.</p>
        </div>

        <button className="refresh" onClick={loadData}>Refresh</button>
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
