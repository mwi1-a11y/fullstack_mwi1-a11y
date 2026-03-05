import { FormEvent, useMemo, useState } from "react";

type AuthMode = "signup" | "login";
type UserRole = "admin" | "member";

type CommunityClass = {
  id: string;
  title: string;
  description: string;
  instructor_name: string;
  location: string;
  starts_at: string;
  capacity: number;
  created_at: string;
  created_by: string;
};

type MemberClass = CommunityClass & {
  registrationCount: number;
  isRegistered: boolean;
};

type AuthResponse = {
  error?: string;
  message?: string;
  accessToken?: string | null;
  role?: UserRole;
};

const envApiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
const apiBaseUrl = (envApiBaseUrl || "http://localhost:4000").replace(/\/$/, "");

function apiUrl(path: string) {
  return `${apiBaseUrl}${path}`;
}

function apiUnreachableMessage(context: string) {
  return `${context} failed because the API is unreachable at ${apiBaseUrl}. Check that the API is running and that CORS allows this web origin.`;
}

function extractGroqOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text;
  }

  if (Array.isArray(record.output_text)) {
    const joined = record.output_text
      .filter((item): item is string => typeof item === "string")
      .join("\n")
      .trim();
    if (joined) {
      return joined;
    }
  }

  if (!Array.isArray(record.output)) {
    return null;
  }

  const chunks: string[] = [];

  for (const outputItem of record.output) {
    if (!outputItem || typeof outputItem !== "object") {
      continue;
    }

    const message = outputItem as Record<string, unknown>;
    if (!Array.isArray(message.content)) {
      continue;
    }

    for (const contentItem of message.content) {
      if (!contentItem || typeof contentItem !== "object") {
        continue;
      }
      const content = contentItem as Record<string, unknown>;
      if (content.type === "output_text" && typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }

  const text = chunks.join("\n").trim();
  return text || null;
}

async function parseApiJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }

  const body = await response.text();
  if (body.trimStart().startsWith("<!DOCTYPE")) {
    throw new Error(
      "Received HTML instead of API JSON. Verify VITE_API_BASE_URL (no trailing slash) and that the API is reachable."
    );
  }

  throw new Error(`Unexpected response from API (${response.status}).`);
}

function roleTitle(role: UserRole) {
  return role === "admin" ? "Admin" : "Member";
}

export default function App() {
  const [authMode, setAuthMode] = useState<AuthMode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<UserRole | null>(null);
  const [status, setStatus] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [classesLoading, setClassesLoading] = useState(false);
  const [adminClasses, setAdminClasses] = useState<CommunityClass[]>([]);
  const [memberClasses, setMemberClasses] = useState<MemberClass[]>([]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [instructorName, setInstructorName] = useState("");
  const [location, setLocation] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [capacity, setCapacity] = useState("20");
  const [createLoading, setCreateLoading] = useState(false);

  const [registeringClassId, setRegisteringClassId] = useState<string | null>(null);
  const [groqQuery, setGroqQuery] = useState<string>("");
  const [groqResult, setGroqResult] = useState<string | null>(null);
  const [groqLoading, setGroqLoading] = useState(false);
  const [groqError, setGroqError] = useState<string | null>(null);

  const dashboardTitle = useMemo(() => {
    if (!currentRole) {
      return "Community Classes";
    }
    return `${roleTitle(currentRole)} Dashboard`;
  }, [currentRole]);

  async function loadAdminClasses(token: string) {
    setClassesLoading(true);
    try {
      const response = await fetch(apiUrl("/api/admin/classes"), {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const data = await parseApiJson<CommunityClass[] | AuthResponse>(response);
      if (!response.ok) {
        const errorData = data as AuthResponse;
        throw new Error(errorData.error ?? "Could not load classes.");
      }

      setAdminClasses(data as CommunityClass[]);
    } finally {
      setClassesLoading(false);
    }
  }

  async function loadMemberClasses(token: string) {
    setClassesLoading(true);
    try {
      const response = await fetch(apiUrl("/api/member/classes"), {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const data = await parseApiJson<MemberClass[] | AuthResponse>(response);
      if (!response.ok) {
        const errorData = data as AuthResponse;
        throw new Error(errorData.error ?? "Could not load classes.");
      }

      setMemberClasses(data as MemberClass[]);
    } finally {
      setClassesLoading(false);
    }
  }

  async function loadDashboard(role: UserRole, token: string) {
    if (role === "admin") {
      await loadAdminClasses(token);
      return;
    }

    await loadMemberClasses(token);
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthLoading(true);
    setStatus("");

    try {
      const endpoint = authMode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const payload = { email, password };

      const response = await fetch(apiUrl(endpoint), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = await parseApiJson<AuthResponse>(response);

      if (!response.ok) {
        setStatus(data.error ?? "Authentication failed.");
        return;
      }

      if (!data.accessToken) {
        setStatus(
          data.message ??
            "Account created. Confirm your email in Supabase settings before logging in."
        );
        return;
      }

      if (!data.role) {
        setStatus("Role was not returned by the API.");
        return;
      }

      setAccessToken(data.accessToken);
      setCurrentRole(data.role);
      setStatus(data.message ?? "Authenticated.");
      await loadDashboard(data.role, data.accessToken);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "Load failed" || error.message === "Failed to fetch") {
          setStatus(apiUnreachableMessage("Authentication"));
          return;
        }
        setStatus(error.message);
        return;
      }
      setStatus(apiUnreachableMessage("Authentication"));
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleCreateClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!accessToken || currentRole !== "admin") {
      setStatus("Only admins can create classes.");
      return;
    }

    const capacityValue = Number(capacity);
    if (!Number.isInteger(capacityValue) || capacityValue <= 0) {
      setStatus("Capacity must be a positive number.");
      return;
    }

    const startsAtMs = Date.parse(startsAt);
    if (Number.isNaN(startsAtMs)) {
      setStatus("Start time must be a valid date and time.");
      return;
    }
    const startsAtIso = new Date(startsAtMs).toISOString();

    setCreateLoading(true);
    setStatus("");

    try {
      const response = await fetch(apiUrl("/api/admin/classes"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          title,
          description,
          instructorName,
          location,
          startsAt: startsAtIso,
          capacity: capacityValue
        })
      });

      const data = await parseApiJson<AuthResponse>(response);
      if (!response.ok) {
        setStatus(data.error ?? "Class creation failed.");
        return;
      }

      setStatus("Class created.");
      setTitle("");
      setDescription("");
      setInstructorName("");
      setLocation("");
      setStartsAt("");
      setCapacity("20");
      await loadAdminClasses(accessToken);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "Load failed" || error.message === "Failed to fetch") {
          setStatus(apiUnreachableMessage("Class creation"));
          return;
        }
        setStatus(error.message);
        return;
      }
      setStatus(apiUnreachableMessage("Class creation"));
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleRegister(classId: string) {
    if (!accessToken || currentRole !== "member") {
      setStatus("Only members can register for classes.");
      return;
    }

    setRegisteringClassId(classId);
    setStatus("");

    try {
      const response = await fetch(apiUrl("/api/member/registrations"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ classId })
      });

      const data = await parseApiJson<AuthResponse>(response);
      if (!response.ok) {
        setStatus(data.error ?? "Registration failed.");
        return;
      }

      setStatus(data.message ?? "Registration successful.");
      await loadMemberClasses(accessToken);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "Load failed" || error.message === "Failed to fetch") {
          setStatus(apiUnreachableMessage("Registration"));
          return;
        }
        setStatus(error.message);
        return;
      }
      setStatus(apiUnreachableMessage("Registration"));
    } finally {
      setRegisteringClassId(null);
    }
  }

  async function handleGroqSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!accessToken) {
      setGroqError("You must be logged in to run queries.");
      return;
    }

    setGroqLoading(true);
    setGroqError(null);
    setGroqResult(null);

    try {
      const response = await fetch(apiUrl("/api/groq"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ query: groqQuery })
      });

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const data = await response.json();
        if (!response.ok) {
          setGroqError(data.error ?? "GROQ query failed.");
        } else {
          const outputText = extractGroqOutputText(data);
          if (!outputText) {
            setGroqError("GROQ response did not include model text output.");
            return;
          }
          setGroqResult(outputText);
        }
      } else {
        const text = await response.text();
        if (!response.ok) {
          setGroqError(text || "GROQ query failed.");
        } else {
          setGroqResult(text);
        }
      }
    } catch (err) {
      if (err instanceof Error) {
        setGroqError(err.message);
      } else {
        setGroqError("Could not reach GROQ endpoint.");
      }
    } finally {
      setGroqLoading(false);
    }
  }

  function logout() {
    setAccessToken(null);
    setCurrentRole(null);
    setAdminClasses([]);
    setMemberClasses([]);
    setStatus("Logged out.");
  }

  return (
    <main className="page">
      <section className="panel">
        <header className="panel-header">
          <div>
            <h1>{dashboardTitle}</h1>
            <p>Local programs for neighbors, families, and lifelong learners.</p>
          </div>
          {accessToken && (
            <button type="button" className="ghost" onClick={logout}>
              Log Out
            </button>
          )}
        </header>

        {!accessToken ? (
          <form onSubmit={handleAuthSubmit} className="stack">
            <div className="toggle-row">
              <button
                type="button"
                className={authMode === "signup" ? "active" : ""}
                onClick={() => setAuthMode("signup")}
              >
                Sign Up
              </button>
              <button
                type="button"
                className={authMode === "login" ? "active" : ""}
                onClick={() => setAuthMode("login")}
              >
                Log In
              </button>
            </div>

            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Password (8+ characters)"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
            <button type="submit" disabled={authLoading}>
              {authLoading
                ? "Please wait..."
                : authMode === "signup"
                  ? "Create Member Account"
                  : "Log In"}
            </button>
          </form>
        ) : currentRole === "admin" ? (
          <>
            <form onSubmit={handleCreateClass} className="stack">
              <h2>Create a Class</h2>
              <input
                type="text"
                placeholder="Class title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
              <textarea
                placeholder="Class description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                required
              />
              <input
                type="text"
                placeholder="Instructor name"
                value={instructorName}
                onChange={(event) => setInstructorName(event.target.value)}
                required
              />
              <input
                type="text"
                placeholder="Location"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                required
              />
              <div className="split">
                <input
                  type="datetime-local"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                  required
                />
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={capacity}
                  onChange={(event) => setCapacity(event.target.value)}
                  required
                />
              </div>
              <button type="submit" disabled={createLoading}>
                {createLoading ? "Saving..." : "Add Class"}
              </button>
            </form>

            <section className="stack">
              <h2>All Classes</h2>
              {classesLoading ? (
                <p>Loading classes...</p>
              ) : adminClasses.length === 0 ? (
                <p>No classes yet.</p>
              ) : (
                <ul className="class-list">
                  {adminClasses.map((item) => (
                    <li key={item.id} className="class-card">
                      <h3>{item.title}</h3>
                      <p>{item.description}</p>
                      <p>
                        <strong>Instructor:</strong> {item.instructor_name}
                      </p>
                      <p>
                        <strong>Location:</strong> {item.location}
                      </p>
                      <p>
                        <strong>Starts:</strong> {new Date(item.starts_at).toLocaleString()}
                      </p>
                      <p>
                        <strong>Capacity:</strong> {item.capacity}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : (
          <section className="stack">
            <h2>Available Classes</h2>
            {classesLoading ? (
              <p>Loading classes...</p>
            ) : memberClasses.length === 0 ? (
              <p>No classes are available yet.</p>
            ) : (
              <ul className="class-list">
                {memberClasses.map((item) => {
                  const isFull = item.registrationCount >= item.capacity;
                  return (
                    <li key={item.id} className="class-card">
                      <h3>{item.title}</h3>
                      <p>{item.description}</p>
                      <p>
                        <strong>Instructor:</strong> {item.instructor_name}
                      </p>
                      <p>
                        <strong>Location:</strong> {item.location}
                      </p>
                      <p>
                        <strong>Starts:</strong> {new Date(item.starts_at).toLocaleString()}
                      </p>
                      <p>
                        <strong>Registered:</strong> {item.registrationCount}/{item.capacity}
                      </p>
                      <button
                        type="button"
                        disabled={item.isRegistered || isFull || registeringClassId === item.id}
                        onClick={() => handleRegister(item.id)}
                      >
                        {item.isRegistered
                          ? "Registered"
                          : isFull
                            ? "Class Full"
                            : registeringClassId === item.id
                              ? "Registering..."
                              : "Register"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {accessToken && (
          <section className="stack">
            <h2>Ask with GROQ</h2>
            <form onSubmit={handleGroqSubmit} className="stack">
              <textarea
                placeholder="Enter GROQ query"
                value={groqQuery}
                onChange={(e) => setGroqQuery(e.target.value)}
                rows={6}
                required
              />
              <button type="submit" disabled={groqLoading}>
                {groqLoading ? "Running..." : "Run Query"}
              </button>
            </form>
            {groqError && <p className="status">{groqError}</p>}
            {groqResult && (
              <pre className="groq-result" style={{ whiteSpace: "pre-wrap" }}>{groqResult}</pre>
            )}
          </section>
        )}

        {status && <p className="status">{status}</p>}
      </section>
    </main>
  );
}
