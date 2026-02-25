import cors from "cors";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

dotenv.config();

type UserRole = "admin" | "member";

type AuthResponse = {
  error?: string;
  message?: string;
};

type AuthenticatedUser = {
  id: string;
  role: UserRole;
};

const port = Number(process.env.PORT ?? 4000);
const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const corsOriginsRaw =
  process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN ?? "http://localhost:5173";
const allowedOrigins = corsOriginsRaw
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

if (!supabaseUrl || !supabasePublishableKey || !supabaseServiceRoleKey) {
  throw new Error(
    "Missing Supabase configuration. Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SERVICE_ROLE_KEY."
  );
}

const authClient = createClient(supabaseUrl, supabasePublishableKey);
const dbClient = createClient(supabaseUrl, supabaseServiceRoleKey);

const app = express();

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  })
);
app.use(express.json());

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100)
});

const createClassSchema = z.object({
  title: z.string().min(2).max(120),
  description: z.string().min(10).max(2000),
  instructorName: z.string().min(2).max(120),
  location: z.string().min(2).max(120),
  startsAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "startsAt must be an ISO 8601 date-time string"
  }),
  capacity: z.number().int().min(1).max(1000)
});

const registerSchema = z.object({
  classId: z.string().uuid()
});

const classInsertSchema = z
  .object({
    created_by: z.string().uuid(),
    title: z.string(),
    description: z.string(),
    instructor_name: z.string(),
    location: z.string(),
    starts_at: z.string(),
    capacity: z.number().int()
  });

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

function readBearerToken(request: Request) {
  const header = request.headers.authorization;
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

async function fetchUserRole(userId: string): Promise<UserRole | null> {
  const { data, error } = await dbClient
    .from("users")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data?.role) {
    return null;
  }

  if (data.role !== "admin" && data.role !== "member") {
    return null;
  }

  return data.role;
}

async function requireUser(
  request: Request,
  response: Response,
  allowedRoles?: UserRole[]
): Promise<AuthenticatedUser | null> {
  const token = readBearerToken(request);

  if (!token) {
    response.status(401).json({ error: "Missing Bearer token" });
    return null;
  }

  const { data, error } = await authClient.auth.getUser(token);

  if (error || !data.user) {
    response.status(401).json({ error: "Invalid or expired token" });
    return null;
  }

  const role = await fetchUserRole(data.user.id);
  if (!role) {
    response.status(403).json({ error: "No user role found for this account." });
    return null;
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    response.status(403).json({ error: "Insufficient role permissions." });
    return null;
  }

  return {
    id: data.user.id,
    role
  };
}

async function upsertUserRole(userId: string, role: UserRole) {
  const { error } = await dbClient
    .from("users")
    .upsert({ id: userId, role }, { onConflict: "id" });

  return error;
}

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.post("/api/auth/signup", async (request, response) => {
  const parsed = signupSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: "Invalid signup payload" });
    return;
  }

  const { data, error } = await authClient.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password
  });

  if (error) {
    response.status(400).json({ error: error.message });
    return;
  }

  if (data.user?.id) {
    const userError = await upsertUserRole(data.user.id, "member");
    if (userError) {
      response.status(500).json({
        error: "Account created but user role could not be saved.",
        details: userError.message
      });
      return;
    }
  }

  response.status(201).json({
    message:
      "Account created. Check your email if confirmation is required by your Supabase auth settings.",
    userId: data.user?.id ?? null,
    accessToken: data.session?.access_token ?? null,
    role: "member" as UserRole
  });
});

app.post("/api/auth/login", async (request, response) => {
  const parsed = loginSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: "Invalid login payload" });
    return;
  }

  const { data, error } = await authClient.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password
  });

  if (error || !data.session) {
    response.status(401).json({ error: error?.message ?? "Login failed" });
    return;
  }

  const role = await fetchUserRole(data.user.id);

  if (!role) {
    response.status(403).json({ error: "No user role found for this account." });
    return;
  }

  response.json({
    message: "Login successful",
    userId: data.user.id,
    accessToken: data.session.access_token,
    role
  });
});

app.get("/api/auth/me", async (request, response) => {
  const user = await requireUser(request, response);
  if (!user) {
    return;
  }

  response.json({
    userId: user.id,
    role: user.role
  });
});

app.get("/api/admin/classes", async (request, response) => {
  const user = await requireUser(request, response, ["admin"]);
  if (!user) {
    return;
  }

  const { data, error } = await dbClient
    .from("community_classes")
    .select("id, title, description, instructor_name, location, starts_at, capacity, created_at, created_by")
    .order("starts_at", { ascending: true });

  if (error) {
    response.status(500).json({ error: error.message });
    return;
  }

  response.json(data ?? []);
});

app.post("/api/admin/classes", async (request, response) => {
  const user = await requireUser(request, response, ["admin"]);
  if (!user) {
    return;
  }

  const parsed = createClassSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({
      error: "Invalid class payload",
      details: parsed.error.flatten()
    });
    return;
  }

  const classPayload = classInsertSchema.parse({
    created_by: user.id,
    title: parsed.data.title,
    description: parsed.data.description,
    instructor_name: parsed.data.instructorName,
    location: parsed.data.location,
    starts_at: new Date(parsed.data.startsAt).toISOString(),
    capacity: parsed.data.capacity
  });

  const { data, error } = await dbClient
    .from("community_classes")
    .insert(classPayload)
    .select("id, title, description, instructor_name, location, starts_at, capacity, created_at, created_by")
    .single();

  if (error) {
    response.status(500).json({ error: error.message });
    return;
  }

  response.status(201).json(data);
});

app.get("/api/member/classes", async (request, response) => {
  const user = await requireUser(request, response, ["member"]);
  if (!user) {
    return;
  }

  const { data: classes, error: classesError } = await dbClient
    .from("community_classes")
    .select("id, title, description, instructor_name, location, starts_at, capacity, created_at, created_by")
    .order("starts_at", { ascending: true });

  if (classesError) {
    response.status(500).json({ error: classesError.message });
    return;
  }

  const { data: registrations, error: registrationsError } = await dbClient
    .from("class_registrations")
    .select("class_id")
    .eq("member_id", user.id);

  if (registrationsError) {
    response.status(500).json({ error: registrationsError.message });
    return;
  }

  const registeredClassIds = new Set((registrations ?? []).map((row) => row.class_id));

  const { data: allRegistrations, error: allRegistrationsError } = await dbClient
    .from("class_registrations")
    .select("class_id");

  if (allRegistrationsError) {
    response.status(500).json({ error: allRegistrationsError.message });
    return;
  }

  const registrationCounts = new Map<string, number>();
  for (const registration of allRegistrations ?? []) {
    const classId = registration.class_id;
    registrationCounts.set(classId, (registrationCounts.get(classId) ?? 0) + 1);
  }

  const responsePayload = (classes ?? []).map((item: CommunityClass) => ({
    ...item,
    registrationCount: registrationCounts.get(item.id) ?? 0,
    isRegistered: registeredClassIds.has(item.id)
  }));

  response.json(responsePayload);
});

app.post("/api/member/registrations", async (request, response) => {
  const user = await requireUser(request, response, ["member"]);
  if (!user) {
    return;
  }

  const parsed = registerSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: "Invalid registration payload" });
    return;
  }

  const { data: classRecord, error: classError } = await dbClient
    .from("community_classes")
    .select("id, capacity")
    .eq("id", parsed.data.classId)
    .maybeSingle();

  if (classError) {
    response.status(500).json({ error: classError.message });
    return;
  }

  if (!classRecord) {
    response.status(404).json({ error: "Class not found" });
    return;
  }

  const { data: existingRegistration, error: existingRegistrationError } = await dbClient
    .from("class_registrations")
    .select("id")
    .eq("class_id", parsed.data.classId)
    .eq("member_id", user.id)
    .maybeSingle();

  if (existingRegistrationError) {
    response.status(500).json({ error: existingRegistrationError.message });
    return;
  }

  if (existingRegistration) {
    response.status(409).json({ error: "You are already registered for this class." });
    return;
  }

  const { count, error: countError } = await dbClient
    .from("class_registrations")
    .select("id", { count: "exact", head: true })
    .eq("class_id", parsed.data.classId);

  if (countError) {
    response.status(500).json({ error: countError.message });
    return;
  }

  if ((count ?? 0) >= classRecord.capacity) {
    response.status(409).json({ error: "This class is full." });
    return;
  }

  const { error: insertError } = await dbClient
    .from("class_registrations")
    .insert({ class_id: parsed.data.classId, member_id: user.id });

  if (insertError) {
    response.status(500).json({ error: insertError.message });
    return;
  }

  response.status(201).json({ message: "Registration successful." } satisfies AuthResponse);
});

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
