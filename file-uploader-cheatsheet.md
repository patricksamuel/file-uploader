# File Uploader — End-to-End Cheat Sheet

A complete build guide for a Google-Drive-style file uploader using **Express**, **Prisma**, **Passport** (session auth), **prisma-session-store**, and **Supabase Storage**, deployed on **Render**.

Stack at a glance:

- **Express** — web server and routing
- **Prisma** — database ORM (talks to PostgreSQL)
- **PostgreSQL (Supabase)** — stores users, folders, file records
- **Passport (local strategy)** — session-based authentication
- **prisma-session-store** — persists sessions in the database
- **Multer** — parses file uploads (`multipart/form-data`)
- **Supabase Storage** — holds the actual file bytes; DB stores only the URL
- **Render** — hosts the running app

> **Mental model:** the database holds *structured data* (users, folders, file records with a URL). Object storage holds the *actual file bytes*. The database never contains the file itself — only a pointer (URL) to where it lives.

---

## Table of Contents

1. [Project & GitHub setup](#1-project--github-setup)
2. [Install dependencies](#2-install-dependencies)
3. [Database & Prisma setup](#3-database--prisma-setup)
4. [The Prisma schema](#4-the-prisma-schema)
5. [Shared library files](#5-shared-library-files)
6. [Express app skeleton](#6-express-app-skeleton)
7. [User authentication (Passport)](#7-user-authentication-passport)
8. [Session store (prisma-session-store)](#8-session-store-prisma-session-store)
9. [Sign-up & login pages](#9-sign-up--login-pages)
10. [Folder CRUD](#10-folder-crud)
11. [File upload, download, delete (Supabase)](#11-file-upload-download-delete-supabase)
12. [Deploying to Render](#12-deploying-to-render)
13. [Common errors & fixes](#13-common-errors--fixes)
14. [Quick command reference](#14-quick-command-reference)

---

## 1. Project & GitHub setup

```bash
# Create and enter the project folder
mkdir file-uploader && cd file-uploader

# Initialise npm (creates package.json)
npm init -y

# Initialise git
git init
```

Create a `.gitignore` **before** committing anything, so secrets and generated files never get pushed:

```gitignore
node_modules/
.env
uploads/
generated/
```

> **Important:** `.env` holds your secrets (database URL, API keys). It must be gitignored. On the server (Render) you'll set these as environment variables instead.

Create the repo on GitHub, then connect it:

```bash
git remote add origin https://github.com/<you>/file-uploader.git
git add .
git commit -m "Initial commit"
git branch -M main
git push -u origin main
```

Suggested folder structure:

```
file-uploader/
├── app.js                 # entry point
├── .env                   # secrets (gitignored)
├── .gitignore
├── package.json
├── prisma/
│   └── schema.prisma
├── generated/prisma/      # generated Prisma client (gitignored)
├── lib/
│   ├── prisma.js          # shared Prisma client
│   └── supabase.js        # shared Supabase client
├── controllers/
│   ├── authControllers.js
│   └── fileControllers.js
├── routers/
│   ├── authRouter.js
│   └── indexRouter.js
├── views/                 # EJS templates
└── public/                # static CSS/JS
```

---

## 2. Install dependencies

```bash
# Core
npm install express ejs dotenv

# Database
npm install prisma @prisma/client @prisma/adapter-pg pg

# Auth & sessions
npm install passport passport-local express-session
npm install @quixo3/prisma-session-store
npm install bcryptjs express-validator

# File handling & storage
npm install multer @supabase/supabase-js
```

> **CommonJS vs ES modules:** This guide uses CommonJS (`require` / `module.exports`). Do **not** put `"type": "module"` in `package.json`. If you do, you must use `import` everywhere instead — mixing the two causes `require is not defined` errors.

---

## 3. Database & Prisma setup

### Initialise Prisma

```bash
npx prisma init
```

This creates `prisma/schema.prisma` and a `.env` with a `DATABASE_URL` placeholder.

### Get your Supabase connection string

1. Create a project at [supabase.com](https://supabase.com).
2. Save the **database password** you set during creation.
3. Find the connection string (Connect → ORM/Prisma, or Database settings).

Supabase gives two connection strings. Prisma uses **both**:

- **Pooled** (port `6543`, via PgBouncer) → for the app's runtime queries → `DATABASE_URL`
- **Direct** (port `5432`) → for migrations → `DIRECT_URL`

Your `.env`:

```dotenv
PORT=3000
DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
SESSION_SECRET="change-this-to-a-long-random-string"
SUPABASE_URL="https://<ref>.supabase.co"
SUPABASE_SECRET_KEY="sb_secret_xxxxxxxxxxxx"
SUPABASE_BUCKET="uploads"
```

> **`SUPABASE_URL` gotcha:** use only the **base** project URL — `https://<ref>.supabase.co`. Do **not** append `/rest/v1/` or any other path. The Supabase client adds service paths (`/storage/v1/`, etc.) itself. Appending a path causes `Invalid path specified in request URL`.

> **Never commit real keys.** The `sb_secret_...` key is full-access. If it ever leaks, regenerate it in the dashboard.

---

## 4. The Prisma schema

`prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../generated/prisma"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

model User {
  id       Int      @id @default(autoincrement())
  email    String   @unique @db.VarChar(255)
  password String   @db.VarChar(255)   // bcrypt hashes are 60 chars — never use VarChar(50)
  joinedAt DateTime @default(now())
  folders  Folder[]
  files    File[]
}

model Folder {
  id       Int      @id @default(autoincrement())
  name     String   @db.VarChar(255)
  addedAt  DateTime @default(now())
  owner_id Int
  owner    User     @relation(fields: [owner_id], references: [id])
  files    File[]
}

model File {
  id          Int      @id @default(autoincrement())
  name        String                       // display name (respects renames)
  object_name String?                      // path inside the Supabase bucket
  path        String                       // public URL from Supabase
  size        Int?
  addedAt     DateTime @default(now())
  owner_id    Int
  owner       User     @relation(fields: [owner_id], references: [id])
  folder_id   Int
  folder      Folder   @relation(fields: [folder_id], references: [id])
}

// Required by prisma-session-store
model Session {
  id        String   @id
  sid       String   @unique
  data      String                          // no @db.MediumText on PostgreSQL — that's MySQL only
  expiresAt DateTime
}
```

Key schema lessons:

- A **relation needs two fields**: the scalar foreign key (`owner_id Int`) *and* the relation field (`owner User @relation(fields: [owner_id], references: [id])`). Both ends of a relation must be declared — the reverse side (`folders Folder[]`) too.
- **`password` must fit a bcrypt hash** (60 chars). `VarChar(50)` throws "value too long."
- On **PostgreSQL**, use plain `String` for large text — `@db.MediumText` is MySQL-only and errors.

### Run the first migration

```bash
npx prisma migrate dev --name init
```

`migrate dev` updates the database **and** regenerates the client in one step.

---

## 5. Shared library files

Create one shared instance of each client and import it everywhere (avoids multiple connections).

`lib/prisma.js`:

```js
require("dotenv/config");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("../generated/prisma/client");

const connectionString = process.env.DATABASE_URL;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

module.exports = { prisma };
```

`lib/supabase.js`:

```js
require("dotenv/config");
const { createClient } = require("@supabase/supabase-js");

const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (!process.env.SUPABASE_URL || !supabaseKey) {
  throw new Error("Missing Supabase environment variables");
}

const supabase = createClient(process.env.SUPABASE_URL, supabaseKey);
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "uploads";

module.exports = { supabase, SUPABASE_BUCKET };
```

> **Import rule:** `module.exports = { prisma }` → import **with** braces: `const { prisma } = require("../lib/prisma")`. `module.exports = prisma` → import **without** braces. Mismatched braces give `undefined`, which surfaces later as `Cannot read properties of undefined`.

> **Require path gotcha:** `require` paths are relative to the *file doing the requiring*, not the project root. From `app.js` at the root, the generated client is `./generated/prisma`. The schema's `output = "../generated/prisma"` is relative to the `prisma/` folder — both resolve to the same place.

---

## 6. Express app skeleton

`app.js` — **middleware order matters**:

```js
// ---------- 1. Requires ----------
require("dotenv").config();

const path = require("node:path");
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const { PrismaSessionStore } = require("@quixo3/prisma-session-store");
const { prisma } = require("./lib/prisma");

require("./config/passport"); // registers the strategy (see §7)

const app = express();

// ---------- 2. View engine ----------
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// ---------- 3. Middleware (ORDER IS MANDATORY) ----------
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true })); // parses req.body
app.use(express.json());

app.use(
  session({
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new PrismaSessionStore(prisma, {
      checkPeriod: 2 * 60 * 1000,
      dbRecordIdIsSessionId: true,
      dbRecordIdFunction: undefined,
    }),
  })
);

app.use(passport.initialize());
app.use(passport.session()); // MUST come after session() + initialize()

// Make the logged-in user available in every view
app.use((req, res, next) => {
  res.locals.user = req.user;
  next();
});

// ---------- 4. Routes ----------
app.use("/", require("./routers/indexRouter"));
app.use("/", require("./routers/authRouter"));

// ---------- 5. Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
```

> **Why order matters:** `express.urlencoded` must come before routes (so `req.body` exists). `session()` must come before `passport.session()`. `passport.session()` must come after both `session()` and `passport.initialize()`.

---

## 7. User authentication (Passport)

### How the pieces fit

- **Passport** = authentication ("who are you"). It checks the password and decides *what* goes into the session.
- **express-session** = the session mechanism (session id + cookie + data).
- **prisma-session-store** = *where* that session data is stored (the database, not RAM).

The browser cookie only ever holds the **session id** — a random string. The actual data lives server-side, keyed by that id.

### Configure the strategy

`config/passport.js`:

```js
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcryptjs");
const { prisma } = require("../lib/prisma");

passport.use(
  new LocalStrategy({ usernameField: "email" }, async (email, password, done) => {
    try {
      const user = await prisma.user.findUnique({
        where: { email: email.trim().toLowerCase() },
      });
      if (!user) return done(null, false, { message: "Incorrect email or password" });

      const match = await bcrypt.compare(password, user.password);
      if (!match) return done(null, false, { message: "Incorrect email or password" });

      return done(null, user);
    } catch (err) {
      return done(err);
    }
  })
);

// SHRINK: store only the id in the session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// EXPAND: turn the id back into req.user on every request
passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: Number(id) } });
    done(null, user);
  } catch (err) {
    done(err);
  }
});
```

Key lessons:

- Use **`findUnique`** for a single user (returns one object or `null`). `findMany` returns an **array** — a wrong email would slip past `if (!user)` because `[]` is truthy.
- In `deserializeUser`, wrap the id in **`Number(id)`** — the session may return it as a string, but your Prisma `id` is an `Int`.

### The auth guard

Add to `controllers/authControllers.js`:

```js
exports.isAuth = (req, res, next) => {
  if (!req.user) return res.redirect("/");
  next();
};
```

Use it as **route middleware**: `router.get("/upload", isAuth, controller)`. It runs before the controller and blocks logged-out users. Apply it to *every* route that needs `req.user`.

### Sign-up / login / logout controllers

`controllers/authControllers.js`:

```js
const { body, validationResult, matchedData } = require("express-validator");
const bcrypt = require("bcryptjs");
const passport = require("passport");
const { prisma } = require("../lib/prisma");

exports.signupPage = (req, res) => res.render("sign-up-form", {});

exports.addUser = [
  body("email").trim().isEmail().withMessage("Valid email required").normalizeEmail(),
  body("password").isLength({ min: 8 }).withMessage("Minimum 8 characters"),
  body("confirmpassword")
    .custom((value, { req }) => value === req.body.password)
    .withMessage("Passwords do not match"),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render("sign-up-form", {
        errors: errors.array(),
        values: { email: req.body.email },
      });
    }
    try {
      const { email, password } = matchedData(req);
      const hashedPassword = await bcrypt.hash(password, 10);
      await prisma.user.create({ data: { email, password: hashedPassword } });
      res.redirect("/");
    } catch (err) {
      next(err);
    }
  },
];

exports.login = passport.authenticate("local", {
  successRedirect: "/",
  failureRedirect: "/",
  failureMessage: true,
});

exports.logout = (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect("/");
  });
};
```

`routers/authRouter.js`:

```js
const { Router } = require("express");
const router = Router();
const auth = require("../controllers/authControllers");

router.get("/sign-up", auth.signupPage);
router.post("/sign-up", auth.addUser);
router.post("/log-in", auth.login);
router.get("/log-out", auth.logout);

module.exports = router;
```

---

## 8. Session store (prisma-session-store)

Already wired into `app.js` in §6. Two requirements:

1. The **`Session` model** in your schema (see §4) — the library reads/writes this table.
2. The `store: new PrismaSessionStore(prisma, {...})` option passed to `session()`.

**How to verify it works:**

1. Log in.
2. Open Prisma Studio (`npx prisma studio`) and check the `Session` table — a row should appear with `sid`, `data`, `expiresAt`.
3. **Restart the server** and refresh — if you're still logged in, persistence works. (The in-memory default fails this test — every restart logs everyone out.)

> Sessions can store more than login state — flash messages, guest carts, multi-step form progress. Sessions work *without* auth too: every visitor gets one. Passport just adds a verified user id into that same session.

---

## 9. Sign-up & login pages

`views/sign-up-form.ejs`:

```html
<!DOCTYPE html>
<html>
<head><title>Sign Up</title></head>
<body>
  <h1>Sign Up</h1>

  <% if (typeof errors !== "undefined") { %>
    <ul>
      <% errors.forEach(e => { %><li><%= e.msg %></li><% }) %>
    </ul>
  <% } %>

  <form action="/sign-up" method="post">
    <label>Email
      <input type="email" name="email"
             value="<%= typeof values !== 'undefined' ? values.email : '' %>" required>
    </label>
    <label>Password <input type="password" name="password" required></label>
    <label>Confirm <input type="password" name="confirmpassword" required></label>
    <button type="submit">Sign Up</button>
  </form>

  <a href="/">Back to login</a>
</body>
</html>
```

`views/index.ejs` (login + landing):

```html
<!DOCTYPE html>
<html>
<head><title>File Uploader</title></head>
<body>
  <% if (user) { %>
    <p>Logged in as <%= user.email %></p>
    <a href="/log-out">Log out</a>
    <a href="/upload">Go to my files</a>
  <% } else { %>
    <h1>Log In</h1>
    <form action="/log-in" method="post">
      <label>Email <input type="email" name="email" required></label>
      <label>Password <input type="password" name="password" required></label>
      <button type="submit">Log In</button>
    </form>
    <a href="/sign-up">Create an account</a>
  <% } %>
</body>
</html>
```

`routers/indexRouter.js`:

```js
const { Router } = require("express");
const router = Router();
router.get("/", (req, res) => res.render("index"));
module.exports = router;
```

---

## 10. Folder CRUD

> A "folder" is **not** a real disk folder — it's a **row** in the `Folder` table. Putting a file "in" a folder means saving that folder's id on the file's row (`folder_id`). It's all database relationships. This project uses **flat** folders (no nesting), which is what the assignment asks for.

`controllers/fileControllers.js` (folder parts):

```js
const { body, validationResult, matchedData } = require("express-validator");
const { prisma } = require("../lib/prisma");

// READ: page listing folders + their files
exports.uploadPage = async (req, res) => {
  const userFolders = await prisma.folder.findMany({
    where: { owner_id: req.user.id },
    include: { files: true },          // nests each folder's files inside it
    orderBy: { id: "asc" },
  });
  res.render("upload-form", { folders: userFolders });
};

// CREATE
exports.newFolder = [
  body("folderName").trim().isLength({ min: 1, max: 255 }).withMessage("1–255 characters"),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render("upload-form", { errors: errors.array(), folders: [] });
    }
    try {
      const { folderName } = matchedData(req);
      await prisma.folder.create({
        data: { name: folderName, owner: { connect: { id: req.user.id } } },
      });
      res.redirect("/upload");
    } catch (err) {
      next(err);
    }
  },
];

// UPDATE (rename)
exports.renameFolder = [
  body("folderName").trim().isLength({ min: 1, max: 255 }).withMessage("1–255 characters"),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).render("upload-form", { errors: errors.array(), folders: [] });
      } // close the if HERE — logic below must be OUTSIDE the error branch

      const { folderName } = matchedData(req);
      const folder_id = Number(req.body.folder_id);
      await prisma.folder.update({ where: { id: folder_id }, data: { name: folderName } });
      res.redirect("/upload");
    } catch (err) {
      next(err);
    }
  },
];

// DELETE (removes folder, its file rows, and the bucket objects)
exports.deleteFolder = async (req, res, next) => {
  try {
    const folder_id = Number(req.body.folder_id);
    const folder = await prisma.folder.findUnique({
      where: { id: folder_id },
      include: { files: true },
    });
    if (!folder) return res.redirect("/upload");

    // remove all files from Supabase in one call
    const names = folder.files.map((f) => f.object_name).filter(Boolean);
    if (names.length) {
      const { supabase, SUPABASE_BUCKET } = require("../lib/supabase");
      await supabase.storage.from(SUPABASE_BUCKET).remove(names);
    }

    // delete children first (FK constraint), then the folder
    await prisma.file.deleteMany({ where: { folder_id } });
    await prisma.folder.delete({ where: { id: folder_id } });
    res.redirect("/upload");
  } catch (err) {
    next(err);
  }
};
```

CRUD method reference:

| Task | Prisma method | Returns |
|------|--------------|---------|
| One row by unique field | `findUnique` | object or `null` |
| One row by any filter | `findFirst` | object or `null` |
| Many rows | `findMany` | array |
| Insert | `create` | created row |
| Update | `update` | updated row |
| Delete one | `delete` | deleted row |
| Delete many | `deleteMany` | count |

Key lessons:

- Set a relation with either `owner: { connect: { id } }` (relation style) **or** the scalar `owner_id: id` — field names must match the schema exactly (`owner_id`, not `owner_Id`).
- Fetch nested data with **`include: { files: true }`** — it must be **inside** the query object (with a comma), not a stray line after it. Without it, `folder.files` is `undefined` and EJS loops crash.
- Watch the **brace placement** in validated controllers — if the success logic sits inside the `if (!errors.isEmpty())` block after its `return`, it never runs (the "button fires but nothing happens" bug).

`views/upload-form.ejs` (folders + files + forms):

```html
<h1>My Files</h1>

<!-- Create folder -->
<form action="/folder" method="post">
  <input name="folderName" placeholder="New folder" required>
  <button>Create Folder</button>
</form>

<ul>
  <% folders.forEach(folder => { %>
    <li>
      <span id="foldername-<%= folder.id %>"><%= folder.name %></span>

      <!-- Rename (hidden until toggled) -->
      <form action="/renamefolder" method="post" id="edit-<%= folder.id %>" style="display:none">
        <input type="hidden" name="folder_id" value="<%= folder.id %>">
        <input name="folderName" value="<%= folder.name %>">
        <button>Save</button>
      </form>
      <button id="buttonEdit-<%= folder.id %>" onclick="toggleEdit(<%= folder.id %>)">Rename</button>

      <!-- Delete folder -->
      <form action="/deletefolder" method="post">
        <input type="hidden" name="folder_id" value="<%= folder.id %>">
        <button>Delete Folder</button>
      </form>

      <!-- Upload INTO this folder: hidden input carries folder id -->
      <form action="/upload" method="post" enctype="multipart/form-data">
        <input type="hidden" name="folder_id" value="<%= folder.id %>">
        <input type="file" name="uploaded_file" required>
        <button>Upload here</button>
      </form>

      <!-- Files in this folder -->
      <ul>
        <% folder.files.forEach(file => { %>
          <li>
            <a href="/download" onclick="event.preventDefault(); this.nextElementSibling.submit();">
              <%= file.name %>
            </a>
            <form action="/download" method="post" style="display:none">
              <input type="hidden" name="file_id" value="<%= file.id %>">
            </form>
            <form action="/delete" method="post" style="display:inline"
                  onsubmit="return confirm('Delete this file?')">
              <input type="hidden" name="file_id" value="<%= file.id %>">
              <button>Delete</button>
            </form>
          </li>
        <% }) %>
      </ul>
    </li>
  <% }) %>
</ul>

<script>
  function toggleEdit(id) {
    for (const prefix of ["edit-", "foldername-", "buttonEdit-"]) {
      const el = document.getElementById(prefix + id);
      el.style.display = el.style.display === "none" ? "block" : "none";
    }
  }
</script>
```

Key HTML lessons:

- **`enctype="multipart/form-data"`** is mandatory on upload forms — without it the file isn't sent and `req.file` is empty.
- **Hidden inputs** carry ids (folder_id, file_id) in the request body. The `name` must exactly match what the controller reads (`req.body.folder_id`).
- Forms only support GET/POST — use POST for delete/download (never GET, which crawlers and prefetch can trigger).
- Keep `id` attributes unique — since folders render in a loop, suffix ids with `<%= folder.id %>`.

---

## 11. File upload, download, delete (Supabase)

### Create the bucket first

In the Supabase dashboard: **Storage → New bucket → name it `uploads`**. Make it **public** for simple public URLs (private buckets require signed URLs). The bucket must exist — referencing a bucket name in code does **not** create it.

### Multer: use memory storage

Since files go to Supabase (not local disk), keep the bytes in memory:

```js
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });
exports.upload = upload; // export so the router can use it
```

Now the bytes are at `req.file.buffer` (not `req.file.path`). You still get `req.file.originalname`, `.mimetype`, `.size`.

### Upload controller

```js
const { supabase, SUPABASE_BUCKET } = require("../lib/supabase");

exports.uploadFile = async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) return res.redirect("/upload");

    // Sanitise the filename for a safe object path (spaces/accents/parens break Supabase paths)
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const objectName = `${req.user.id}/${Date.now()}-${safeName}`;

    // 1. Upload bytes to Supabase
    const { error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(objectName, file.buffer, { contentType: file.mimetype });
    if (error) throw error;

    // 2. Build the public URL (this is just string construction, not a lookup)
    const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(objectName);

    // 3. Save the DB row — store the URL and the object_name (needed for deletes)
    await prisma.file.create({
      data: {
        name: file.originalname,       // real name for display (survives renames)
        object_name: objectName,       // sanitised path in the bucket
        path: data.publicUrl,          // web URL
        size: file.size,
        owner: { connect: { id: req.user.id } },
        folder: { connect: { id: Number(req.body.folder_id) } },
      },
    });

    res.redirect("/upload");
  } catch (err) {
    next(err);
  }
};
```

Key lessons:

- **You choose the object name** up front. `getPublicUrl(objectName)` then just *builds a string* (`<url>/storage/v1/object/public/<bucket>/<objectName>`) — it doesn't verify the file exists. So the `upload()` error check is what confirms success.
- **Store `object_name`** in the DB — you need it to delete from Supabase later; you can't reliably reconstruct it from the URL.
- **Sanitise the filename** for the path, but store the **original** name in `name` for display.
- Convert `req.body.folder_id` with `Number(...)` — form values arrive as strings; `Number(undefined)` → `NaN` means the form didn't send `folder_id`.

### Download controller (forces the current name)

```js
exports.downloadFile = async (req, res, next) => {
  try {
    const file_id = Number(req.body.file_id);
    const file = await prisma.file.findUnique({ where: { id: file_id } });
    if (!file) return res.redirect("/upload");

    // download: file.name forces a save with the latest name from the DB
    const { data } = supabase.storage
      .from(SUPABASE_BUCKET)
      .getPublicUrl(file.object_name, { download: file.name });

    res.redirect(data.publicUrl);
  } catch (err) {
    next(err);
  }
};
```

> Uses `file.object_name` to reference the stored object and `download: file.name` to force a download under the current (possibly renamed) name. A bare `res.redirect(file.path)` would only *display* the file, not download it.

### Delete controller

```js
exports.deleteFile = async (req, res, next) => {
  try {
    const file_id = Number(req.body.file_id);
    const file = await prisma.file.findUnique({ where: { id: file_id } });
    if (!file) return res.redirect("/upload");

    // remove from Supabase (takes an ARRAY, even for one file)
    const { error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .remove([file.object_name]);
    if (error) throw error;

    await prisma.file.delete({ where: { id: file_id } });
    res.redirect("/upload");
  } catch (err) {
    next(err);
  }
};
```

### File router

`routers/fileRouter.js`:

```js
const { Router } = require("express");
const router = Router();
const file = require("../controllers/fileControllers");
const { isAuth } = require("../controllers/authControllers");

router.get("/upload", isAuth, file.uploadPage);
router.post("/upload", isAuth, file.upload.single("uploaded_file"), file.uploadFile);
router.post("/download", isAuth, file.downloadFile);
router.post("/delete", isAuth, file.deleteFile);

router.post("/folder", isAuth, file.newFolder);
router.post("/renamefolder", isAuth, file.renameFolder);
router.post("/deletefolder", isAuth, file.deleteFolder);

module.exports = router;
```

> The string in `upload.single("uploaded_file")` **must** match the file input's `name`. A mismatch throws `MulterError: Unexpected field`. Multer must sit in the route (before the controller) so `req.file` is populated.

Register it in `app.js`: `app.use("/", require("./routers/fileRouter"));`

---

## 12. Deploying to Render

### Prerequisites

1. Code pushed to GitHub.
2. `.env` is gitignored (never committed).
3. Supabase database migrated and bucket created.

### Create the Render service

1. Render dashboard → **New → Web Service** → connect your GitHub repo.
2. Set the commands:

**Build Command:**
```
npm install && npx prisma generate && npx prisma migrate deploy
```

**Start Command:**
```
node app.js
```

Why each part:

- `npm install` — installs dependencies.
- `npx prisma generate` — rebuilds the Prisma client (the `generated/` folder is gitignored, so it must be created on Render).
- `npx prisma migrate deploy` — applies existing migrations to the database (production-safe; unlike `migrate dev`, it never prompts or creates new migrations).

### Set environment variables

Your `.env` isn't deployed, so add each variable in Render's **Environment** section:

| Variable | Notes |
|----------|-------|
| `DATABASE_URL` | Supabase pooled connection string |
| `DIRECT_URL` | Supabase direct connection string |
| `SUPABASE_URL` | base project URL only |
| `SUPABASE_SECRET_KEY` | keep secret; use a freshly rotated key |
| `SUPABASE_BUCKET` | `uploads` |
| `SESSION_SECRET` | long random string |

> **Do not set `PORT`.** Render provides its own `PORT`, and your code already reads `process.env.PORT`.

### Deploy & verify

1. Trigger the deploy. Watch the build log for errors.
2. Visit the Render URL, sign up, log in, create a folder, upload a file.
3. Confirm the file appears in the Supabase bucket and the DB row has a real URL.

Common deploy failures:

- **Crash on startup, "Missing Supabase environment variables"** → an env var isn't set in Render.
- **"Cannot find module generated/prisma"** → `npx prisma generate` missing from the build command.
- **Database connection errors** → wrong `DATABASE_URL`, or migrations not applied.

---

## 13. Common errors & fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `require is not defined in ES module scope` | `"type": "module"` in package.json | Remove it, or switch to `import` |
| `Cannot find module '../generated/prisma'` | Wrong require path / client not generated | Fix path (`./generated/prisma` from root); run `npx prisma generate` |
| `Native type MediumText is not supported for postgresql` | MySQL type on Postgres | Use plain `String` |
| `value too long for the column's type` | `password VarChar(50)` too small for bcrypt | Use `VarChar(255)` or `String` |
| `Cannot read properties of undefined (reading 'create')` | `prisma` imported wrong (braces mismatch) | Match `module.exports` to import |
| `Argument where needs at least one of id` | Used `findUnique` on a non-unique field | Use `findMany` (array) or `findFirst` |
| `Argument owner is missing` | Set scalar with wrong field name | Use `owner: { connect: { id } }` or exact scalar name |
| `Cannot read properties of undefined (reading 'forEach')` | Missing `include: { files: true }` | Add it *inside* the query object |
| Button "fires" but controller does nothing | Success logic trapped inside `if (!errors)` block | Close the `if` before the main logic |
| `MulterError: Unexpected field` | Form field name ≠ `upload.single("...")` | Make them identical |
| `Invalid path specified in request URL` | `SUPABASE_URL` has `/rest/v1/`, or bucket missing | Use base URL only; create the bucket |
| `folder_id: NaN` | Form didn't send `folder_id` | Add hidden input with matching `name` |
| `Unknown argument object_name` | Column not in schema / not migrated | Add field, run `migrate dev` |

---

## 14. Quick command reference

```bash
# Project setup
npm init -y
git init

# Prisma
npx prisma init                              # create schema + .env
npx prisma migrate dev --name <label>        # change MODELS: migrate DB + regenerate client
npx prisma generate                          # rebuild client only (after changing generator/output)
npx prisma migrate deploy                    # apply migrations in production (Render build step)
npx prisma studio                            # visual DB browser

# Run locally
node app.js
node --watch app.js                          # auto-restart on file changes

# Git
git add . && git commit -m "message"
git push
```

### When to run which Prisma command

- Edited a **model** (table/column/field)? → `npx prisma migrate dev --name <label>` (also regenerates).
- Edited the **generator/output** or reinstalled? → `npx prisma generate`.
- Edited **app code / controllers / EJS**? → neither, just restart.
- Adding a **required column to a populated table**? → add it as optional (`String?`) first, migrate, backfill, then make required. Or use `@map` for a pure rename with no data change.

---

*Built from a working Express + Prisma + Passport + Supabase file uploader. Adapt field names and paths to your own project.*
