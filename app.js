// ---------- 1. Requires ----------
require("dotenv").config();   // FIRST — anything reading process.env before this gets undefined

const path = require("node:path");
const { Pool } = require("pg");
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcryptjs");




const expressSession = require('express-session');
require('dotenv/config');
const { PrismaPg } = require('@prisma/adapter-pg');  // For other db adapters, see Prisma docs
const { PrismaClient } = require('./generated/prisma/client');
const { PrismaSessionStore } = require('@quixo3/prisma-session-store');


 // DATABASE_URL defined in env file included in prisma.config.js; see Prisma docs
const connectionString = `${process.env.DATABASE_URL}`;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const app = express();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------- 2. View engine ----------
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// ---------- 3. Middleware (ORDER IS MANDATORY) ----------
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));   // parses req.body — register ONCE only
app.use(express.json());


app.use(
  expressSession({
    cookie: {
     maxAge: 7 * 24 * 60 * 60 * 1000 // ms
    },
    secret: 'a santa at nasa',
    resave: true,
    saveUninitialized: true,
    store: new PrismaSessionStore(
      prisma,
      {
        checkPeriod: 2 * 60 * 1000,  //ms
        dbRecordIdIsSessionId: true,
        dbRecordIdFunction: undefined,
      }
    )
  })
);

app.use(passport.initialize());                    // must be wrapped in app.use(...)
app.use(passport.session());                       // must come AFTER session() + initialize()

// ---------- 4. Passport config (registers functions; not per-request) ----------
// passport.use(...), serializeUser, deserializeUser  — see §4

passport.use(
  new LocalStrategy({ usernameField: "email" }, async (email, password, done) => {
    try {
      const user = await prisma.user.findUnique({
        where: {email: email.trim().toLowerCase()}
      })
      if (!user) return done(null, false, { message: "Incorrect email or password" });

      const match = await bcrypt.compare(password, user.password);
      if (!match) return done(null, false, { message: "Incorrect email or password" });

      return done(null, user);
    } catch (err) {
      return done(err);
    }
  })
);

passport.serializeUser((user, done) => {
  done(null, user.id);          // SHRINK: store only the id in the session
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({
        where: {id: Number(id)}
    })
    done(null, user);        // EXPAND: this object becomes req.user
  } catch (err) {
    done(err);
  }
});
app.use((req, res, next) => {   res.locals.user = req.user;   next(); }); // site wide user


// ---------- 5. Routes ----------
const indexRouter = require("./routers/indexRouter")
app.use("/",indexRouter)
const authRouter = require("./routers/authRouters")
app.use("/",authRouter)
const fileRouters = require("./routers/fileRouters")
app.use("/",fileRouters)



// ---------- 6. Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));