import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError, fieldError } from "@/components/common";

function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-ink p-10 text-white lg:flex">
        <span className="flex items-center gap-2 font-semibold"><img src="/favicon.svg" alt="" className="h-7 w-7 rounded bg-white p-0.5" />Signage CMS</span>
        <div className="grid grid-cols-3 gap-4 opacity-90" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`rounded border-4 border-white/10 ${i % 3 === 1 ? "h-28" : "h-16"} ${i === 1 || i === 3 ? "bg-[hsl(184_85%_28%)]" : "bg-white/5"}`} />
          ))}
        </div>
        <p className="max-w-sm text-sm text-white/60">Every screen in every location, managed from one place. Content keeps playing even when the network doesn't.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mb-6 mt-1 text-sm text-muted-foreground">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await login(email, password); navigate("/"); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <AuthFrame title="Sign in" subtitle="Manage your screens, content and schedules.">
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Email" htmlFor="email"><Input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></Field>
        <Field label="Password" htmlFor="password"><Input id="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></Field>
        <FormError error={error} />
        <Button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
        <p className="text-center text-sm text-muted-foreground">New here? <Link className="text-primary hover:underline" to="/register">Create an organization</Link></p>
      </form>
    </AuthFrame>
  );
}

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({ organizationName: "", fullName: "", email: "", password: "" });
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await register({ ...f, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }); navigate("/"); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <AuthFrame title="Create your organization" subtitle="Start on the Free plan: up to 3 screens, no card needed.">
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Organization name" error={fieldError(error, "organizationName")}><Input required value={f.organizationName} onChange={set("organizationName")} /></Field>
        <Field label="Your name" error={fieldError(error, "fullName")}><Input required autoComplete="name" value={f.fullName} onChange={set("fullName")} /></Field>
        <Field label="Work email" error={fieldError(error, "email")}><Input type="email" required autoComplete="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Password" error={fieldError(error, "password")} hint="At least 8 characters, with a letter and a number.">
          <Input type="password" required autoComplete="new-password" value={f.password} onChange={set("password")} />
        </Field>
        {error && !fieldError(error, "email") && !fieldError(error, "password") ? <FormError error={error} /> : null}
        <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create organization"}</Button>
        <p className="text-center text-sm text-muted-foreground">Already have an account? <Link className="text-primary hover:underline" to="/login">Sign in</Link></p>
      </form>
    </AuthFrame>
  );
}
