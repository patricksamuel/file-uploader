const express = require("express");
const router = express.Router();

const authControllers = require("../controllers/authControllers");



router.get("/sign-up", authControllers.signupPage);
router.post("/sign-up", authControllers.addUser);
router.post("/log-in", authControllers.login);
router.get("/log-out", authControllers.logout);
router.get("/upgrade", authControllers.upgradeGet);
router.post("/upgrade", authControllers.upgradePost);



module.exports = router;