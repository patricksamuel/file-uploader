const express = require("express");
const router = express.Router();
const multer  = require('multer')

const fileControllers = require("../controllers/fileControllers");
const {isAuth} = require("../controllers/authControllers")




const upload = multer({ storage:multer.memoryStorage()});   // define once, here




router.get("/upload",isAuth, fileControllers.uploadPage);
router.post("/upload",isAuth,upload.single('upload'), fileControllers.uploadFile);
router.post("/newfolder",isAuth, fileControllers.newFolder);
router.post("/delete",isAuth, fileControllers.deleteFile);
router.post("/deletefolder",isAuth, fileControllers.deleteFolder);
router.post("/renamefolder",isAuth, fileControllers.renameFolder);
router.post("/renamefile",isAuth, fileControllers.renameFile);
router.post("/downloadfile",isAuth, fileControllers.downloadFile);


module.exports = router;