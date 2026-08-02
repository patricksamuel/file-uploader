//./controllers/authControllers.js

const { body, validationResult, matchedData } = require("express-validator");
const bcrypt = require("bcryptjs");

const passport = require("passport");
const { prisma } = require("../lib/sigma");

exports.isAuth = (req, res, next) => {
  if (!req.user) return res.redirect("/");
  next();
};


exports.signupPage = async (req,res) =>{
    res.render("sign-up-form",{})
}

exports.addUser = [
    body("email").trim()
        .isEmail().withMessage(`Email required`).normalizeEmail(),
    body("password")
        .isLength({ min: 3}).withMessage(`Minimum 8 characters`),
    body("confirmpassword")
        .custom((value,{req})=> value === req.body.password).withMessage("Passwords do not match"),
    async (req,res, next) => {
        console.log("adding new user")
        const errors = validationResult(req);
            if (!errors.isEmpty()) {
            return res.status(400).render("sign-up-form", {
                errors: errors.array(),
                values: { email: req.body.email}, // so that when error it will repopulated the prefilled values on the form
            });
            }
        try {
            const { email, password } = matchedData(req)
            const hashedPassword = await bcrypt.hash(password, 10);

            await prisma.user.create({
                data:{
                    email: email,
                    password : hashedPassword,

                }
            })
            res.redirect("/");

        } catch (err) {
            return next(err);
        }
    }]

exports.login =
    passport.authenticate("local", {
        successRedirect: "/",
        failureRedirect: "/",
        failureMessage: true,

    }) // no need req res it is a middle ware; we simply throwi it away

exports.logout = (req,res, next) => {
    req.logout((err)=>{
        if (err) {
            return next(err)
        }
        res.redirect("/")
    }
    )
}

exports.upgradeGet =  (req,res) => {
    console.log("req.user:", req.user, "session:", req.session);
    if (!req.user) return res.redirect("/");
    res.render("upgrade-form",{})
}


exports.upgradePost =  async (req,res) => {
    if (req.body.upgradePin === process.env.ADMIN_PIN){
        console.log("req.user:", req.user, "session:", req.session);
        await db.editUser(req.user.id,req.user.email,req.user.password,req.user.firstname, req.user.lastname, 'admin')
        return res.redirect("/")
    }
    return res.status(400).render("upgrade-form", { error: "Wrong passcode" });

}