module.exports = async function (req, res) {
  const { handleDecision } = await import("../endpoint.mjs");
  return handleDecision(req, res);
};
