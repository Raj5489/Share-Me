// OPTIONAL: Add this single line after your existing routes in server.js
// This won't affect your current functionality but helps with Render monitoring

// Add this line after: app.get("/", (req, res) => { ... });
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    uptime: process.uptime(),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
  });
});

// This endpoint helps Render monitor your app's health without affecting performance
