import express from "express";
import errorMiddleware from "./middleware/error.middleware.js";
import investmentRoutes from "./routes/investment.routes.js";
import roiRecordRoutes from "./routes/recore.routes.js";
import referralRoutes from "./routes/refferel.routes.js";
import subscriptionRoutes from "./routes/subscription.routes.js";
import support from "./routes/support.routes.js";
import transactionRoutes from "./routes/transaction.routes.js";
import transferRoutes from "./routes/transfer.routes.js";
import userRoutes from "./routes/user.routes.js";
import walletRoutes from "./routes/wallet.routes.js";
import withdrawalRoutes from "./routes/withdraw.routes.js";

import cors from "cors";

import adminRoutes from "./routes/admin.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import qrRoutes from "./routes/qr.routes.js";

import routers from "./routes/active.routes.js";
import enquiryRoutes from "./routes/enquiry.routes.js";
import userDashboardRoute from "./routes/userDashboard.routes.js";
import notificationRoutes from "./routes/notification.routes.js";

const app = express();

app.use(cors({
  origin: [
    "http://localhost:8080",
    "http://localhost:8081",
    "https://www.expotradex.com",
    "https://expo-trading-admin.vercel.app"
  ],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  exposedHeaders: ["Authorization"]
}));

app.use(express.json({
  // verify: (req: any, res: any, buf: any) => {
  //   const url = (req as any).originalUrl;
  //   if (url && url.startsWith("/api/payment/webhook")) {
  //     (req as any).rawBody = buf.toString();
  //   }
  // },
}));
app.use(express.static("src/views"));
 
app.get("/", (req, res) => {
  return res.sendFile("index.html", { root: "src/views" });
  
});

// routes
app.use('/api/user', userRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/withdraw', withdrawalRoutes);
app.use('/api/investment', investmentRoutes);
app.use('/api/record', roiRecordRoutes);
app.use('/api/referral', referralRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/transaction', transactionRoutes);
app.use('/api/transfer', transferRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/payment/webhook', paymentRoutes);
app.use('/api/support-tickets', support);
app.use("/api/admin", adminRoutes);
app.use('/api/qr-code', qrRoutes);
app.use('/api/dashboardRoutes',dashboardRoutes);
app.use('/api/setting', routers);

app.use("/api/enquiry", enquiryRoutes);

app.use("/api/user-dashboard", userDashboardRoute)
app.use("/api/notifications", notificationRoutes);

app.use(errorMiddleware);

app.listen(4000, () => {
    console.log("Server is running on port 4000");
});
