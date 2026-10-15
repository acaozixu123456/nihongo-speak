"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) window.location.href = "/";
    else setError("密码不对");
  }

  return (
    <main>
      <h1>日语听说练习</h1>
      <form onSubmit={submit} className="card">
        <p className="muted">输入你在部署时设置的密码。</p>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" type="submit">进入</button>
          {error && <span className="error">{error}</span>}
        </div>
      </form>
    </main>
  );
}
