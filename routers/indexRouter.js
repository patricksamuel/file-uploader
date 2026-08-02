const express = require("express");
const router = express.Router();


router.get("/", async (req, res) => {
  console.log("req.user:", req.user, "session:", req.session);
  res.render("index", { }); // 
});


module.exports = router;