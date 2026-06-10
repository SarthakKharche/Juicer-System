import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api/client";
import "./style.css";

function App() {
  const [jobs, setJobs] = useState([]);

  async function loadJobs() {
    const res = await api.get("/juicer/jobs");
    setJobs(res.data);
  }

  async function updateJob(jobId, action) {
    const body = action === "plugged-in" ? { charger_id: "CHARGER_001" } : {};
    await api.post(`/juicer/jobs/${jobId}/${action}`, body);
    await loadJobs();
  }

  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <main className="container">
      <h1>Juicer Job Dashboard</h1>
      <p>Live job queue for movable fast charger operations.</p>
      <section className="grid">
        {jobs.map((job) => (
          <article className="card" key={job.job_id}>
            <h2>{job.slot_id}</h2>
            <p><b>Vehicle:</b> {job.vehicle_number || "Pending"}</p>
            <p><b>Phone:</b> {job.phone_number}</p>
            <p><b>Status:</b> {job.current_step}</p>
            <small>{job.job_id}</small>
            <div className="actions">
              <button onClick={() => updateJob(job.job_id, "accept")}>Accept</button>
              <button onClick={() => updateJob(job.job_id, "plugged-in")}>Plugged In</button>
              <button onClick={() => updateJob(job.job_id, "complete")}>Complete</button>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
