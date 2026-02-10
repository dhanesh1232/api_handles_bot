export const verifyCoreToken = (req, res, next) => {
  const token = req.headers["x-core-api-key"];
  const expectedToken =
    process.env.CORE_API_KEY || "EmraK+U2worp7R5TpNVkqpmYa6v2OKiX+fqLbuHRcNA=";

  if (!token || token !== expectedToken) {
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized: Invalid Core API Key" });
  }
  next();
};
