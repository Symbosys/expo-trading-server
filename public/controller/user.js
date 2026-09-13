import bcrypt from 'bcryptjs'; // For password hashing
import { StatusCodes } from 'http-status-codes';
import { v4 as uuidv4 } from 'uuid'; // For generating referral codes
import { Prisma, ReferralStatus } from '../../generated/prisma/index.js';
import prisma from '../config/prisma.js';
import { JWT } from '../utils/jwt.utils.js';
// Controller functions
export const userController = {
    // Create a new user
    async createUser(req, res) {
        try {
            const { name, email, password, walletAddress, referredByCode } = req.body;
            // Validate required fields
            if (!email || !password) {
                return res.status(StatusCodes.BAD_REQUEST).json({
                    error: 'Email and password are required',
                });
            }
            // Check if user already exists
            const existingUser = await prisma.user.findUnique({ where: { email } });
            if (existingUser) {
                return res.status(StatusCodes.CONFLICT).json({
                    error: 'Email already exists',
                });
            }
            // Hash password
            const passwordHash = await bcrypt.hash(password, 10);
            // Generate unique referral code
            let referralCode;
            let existingReferral;
            do {
                referralCode = `EXPO${uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
                existingReferral = await prisma.user.findUnique({
                    where: { referralCode },
                });
            } while (existingReferral);
            // Find referredBy user (if provided)
            let referredById = null;
            if (referredByCode) {
                const referrer = await prisma.user.findUnique({
                    where: { referralCode: referredByCode },
                });
                if (!referrer) {
                    return res.status(StatusCodes.BAD_REQUEST).json({
                        error: 'Invalid referral code',
                    });
                }
                referredById = referrer.id;
            }
            // Create the new user
            const user = await prisma.user.create({
                data: {
                    name,
                    email,
                    passwordHash,
                    walletAddress,
                    referralCode,
                    referredById,
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    walletAddress: true,
                    referralCode: true,
                    usdtBalance: true,
                    totalReferrals: true,
                    totalEarnings: true,
                    currentLevel: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });
            // If referred by someone, update referrer's stats and create referral record
            if (referredById) {
                await prisma.user.update({
                    where: { id: referredById },
                    data: { totalReferrals: { increment: 1 } },
                });
                await prisma.referral.create({
                    data: {
                        referrerId: referredById,
                        referredUserId: user.id,
                        level: 1,
                        bonusPercentage: 0.05,
                        bonusStartDate: new Date(),
                        bonusEndDate: new Date(Date.now() + 12 * 30 * 24 * 60 * 60 * 1000),
                        status: ReferralStatus.ACTIVE,
                    },
                });
            }
            // Create wallet if provided
            if (walletAddress) {
                await prisma.wallet.create({
                    data: {
                        userId: user.id,
                        walletAddress,
                        currency: 'USDT',
                        balance: 0,
                    },
                });
            }
            const token = JWT.generateToken({ id: user.id, email: user.email });
            res.cookie("token", token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "strict",
                maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
            }).header("Authorization", `Bearer ${token}`).json({
                message: 'User created successfully',
                data: user,
                token: token,
            });
        }
        catch (error) {
            console.error('Error creating user:', error);
            return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                error: 'Failed to create user: ' + error.message,
            });
        }
    },
    // Login a user
    async loginUser(req, res) {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                return res.status(StatusCodes.BAD_REQUEST).json({
                    error: 'Email and password are required',
                });
            }
            const user = await prisma.user.findUnique({ where: { email } });
            if (!user) {
                return res.status(StatusCodes.NOT_FOUND).json({
                    error: 'Invalid email or password',
                });
            }
            const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
            if (!isPasswordValid) {
                return res.status(StatusCodes.UNAUTHORIZED).json({
                    error: 'Invalid email or password',
                });
            }
            const token = JWT.generateToken({ id: user.id, email: user.email });
            res.cookie("token", token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "strict",
                maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
            }).header("Authorization", `Bearer ${token}`).json({
                message: 'User logged in successfully',
                data: user,
                token: token,
            });
        }
        catch (error) {
            console.error('Error logging in user:', error);
            return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                error: 'Failed to login user: ' + error.message,
            });
        }
    },
    // Get a user by ID
    async getUserById(req, res) {
        try {
            const { id } = req.params;
            const user = await prisma.user.findUnique({
                where: { id: id },
                include: {
                    wallet: true,
                    referredBy: { select: { id: true, name: true, email: true } },
                    investments: {
                        where: { status: 'ACTIVE' },
                        include: { plan: true },
                    },
                },
            });
            if (!user) {
                return res.status(StatusCodes.NOT_FOUND).json({ error: 'User not found' });
            }
            // --------------------------------------------------
            // ROI CALCULATION (SAFE, IDEMPOTENT)
            // --------------------------------------------------
            const today = new Date();
            today.setHours(0, 0, 0, 0); // NEVER credit today
            for (const investment of user.investments) {
                const plan = investment.plan;
                const amountInvested = Number(investment.amountInvested);
                // Find last credited ROI day
                const lastROI = await prisma.rOIRecord.findFirst({
                    where: { investmentId: investment.id },
                    orderBy: { creditedForDate: 'desc' },
                });
                let cursorDate = lastROI && lastROI.creditedForDate
                    ? new Date(lastROI.creditedForDate)
                    : new Date(investment.startDate);
                cursorDate.setDate(cursorDate.getDate() + 1);
                cursorDate.setHours(0, 0, 0, 0);
                // ---------------- DAILY ROI ----------------
                if (plan.roiPerDay) {
                    const dailyRoi = amountInvested * Number(plan.roiPerDay);
                    const roiRecords = [];
                    const transactions = [];
                    let totalAmount = 0;
                    while (cursorDate < today) {
                        const day = cursorDate.getDay(); // 0 Sun, 6 Sat
                        if (day >= 1 && day <= 5) {
                            totalAmount += dailyRoi;
                            roiRecords.push({
                                userId: user.id,
                                investmentId: investment.id,
                                creditedForDate: new Date(cursorDate),
                                roiAmount: new Prisma.Decimal(dailyRoi),
                                isReferralBonusApplied: false,
                                weekNumber: 0
                            });
                            transactions.push({
                                userId: user.id,
                                type: 'ROI',
                                amount: new Prisma.Decimal(dailyRoi),
                                status: 'SUCCESS',
                                description: `Daily ROI for ${cursorDate.toDateString()}`,
                                investmentId: investment.id,
                            });
                        }
                        cursorDate.setDate(cursorDate.getDate() + 1);
                    }
                    if (roiRecords.length > 0) {
                        await prisma.$transaction([
                            prisma.wallet.update({
                                where: { userId: user.id },
                                data: { balance: { increment: new Prisma.Decimal(totalAmount) } },
                            }),
                            prisma.rOIRecord.createMany({
                                data: roiRecords,
                                skipDuplicates: true, // DB-level safety
                            }),
                            prisma.transaction.createMany({
                                data: transactions,
                            }),
                        ]);
                    }
                }
                // ---------------- MONTHLY ROI ----------------
                else if (plan.roiPerMonth) {
                    const monthlyRoi = amountInvested * Number(plan.roiPerMonth);
                    const roiRecords = [];
                    const transactions = [];
                    let totalAmount = 0;
                    while (cursorDate < today) {
                        const nextMonth = new Date(cursorDate);
                        nextMonth.setMonth(nextMonth.getMonth() + 1);
                        if (nextMonth <= today) {
                            totalAmount += monthlyRoi;
                            roiRecords.push({
                                userId: user.id,
                                investmentId: investment.id,
                                creditedForDate: nextMonth,
                                roiAmount: new Prisma.Decimal(monthlyRoi),
                                isReferralBonusApplied: false,
                                weekNumber: 0
                            });
                            transactions.push({
                                userId: user.id,
                                type: 'ROI',
                                amount: new Prisma.Decimal(monthlyRoi),
                                status: 'SUCCESS',
                                description: `Monthly ROI for ${nextMonth.toLocaleString('en-US', {
                                    month: 'long',
                                    year: 'numeric',
                                })}`,
                                investmentId: investment.id,
                            });
                        }
                        cursorDate = nextMonth;
                    }
                    if (roiRecords.length > 0) {
                        await prisma.$transaction([
                            prisma.wallet.update({
                                where: { userId: user.id },
                                data: { balance: { increment: new Prisma.Decimal(totalAmount) } },
                            }),
                            prisma.rOIRecord.createMany({
                                data: roiRecords,
                                skipDuplicates: true,
                            }),
                            prisma.transaction.createMany({
                                data: transactions,
                            }),
                        ]);
                    }
                }
            }
            // --------------------------------------------------
            // RETURN UPDATED USER
            // --------------------------------------------------
            const updatedUser = await prisma.user.findUnique({
                where: { id: id },
                include: {
                    wallet: true,
                    referredBy: { select: { id: true, name: true, email: true } },
                },
            });
            return res.status(StatusCodes.OK).json({ data: updatedUser });
        }
        catch (error) {
            console.error('Error:', error);
            return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                error: 'Failed to fetch user',
            });
        }
    },
    // Update a user
    async updateUser(req, res) {
        try {
            const id = req.params.id;
            const { name, email, walletAddress, password } = req.body;
            // Check if user exists
            const user = await prisma.user.findUnique({ where: { id } });
            if (!user) {
                return res.status(StatusCodes.NOT_FOUND).json({
                    error: 'User not found',
                });
            }
            // Prepare update data
            const updateData = {};
            if (name !== undefined)
                updateData.name = name;
            if (email) {
                const existingEmail = await prisma.user.findUnique({ where: { email } });
                if (existingEmail && existingEmail.id !== id) {
                    return res.status(StatusCodes.CONFLICT).json({
                        error: 'Email already in use',
                    });
                }
                updateData.email = email;
            }
            if (walletAddress !== undefined)
                updateData.walletAddress = walletAddress;
            if (password)
                updateData.passwordHash = await bcrypt.hash(password, 10);
            // Update user
            const updatedUser = await prisma.user.update({
                where: { id },
                data: updateData,
                select: {
                    id: true,
                    name: true,
                    email: true,
                    walletAddress: true,
                    referralCode: true,
                    usdtBalance: true,
                    totalReferrals: true,
                    totalEarnings: true,
                    currentLevel: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });
            // Update wallet if walletAddress is provided
            if (walletAddress !== undefined && user.walletAddress !== walletAddress) {
                await prisma.wallet.upsert({
                    where: { userId: id },
                    update: { walletAddress },
                    create: {
                        userId: id,
                        walletAddress,
                        currency: 'USDT',
                        balance: 0,
                    },
                });
            }
            return res.status(StatusCodes.OK).json({
                message: 'User updated successfully',
                data: updatedUser,
            });
        }
        catch (error) {
            console.error('Error updating user:', error);
            return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                error: 'Failed to update user',
            });
        }
    },
    // Delete a user
    async deleteUser(req, res) {
        try {
            const id = req.params.id;
            const user = await prisma.user.findUnique({ where: { id } });
            if (!user) {
                return res.status(StatusCodes.NOT_FOUND).json({
                    error: 'User not found',
                });
            }
            await prisma.user.update({
                where: { id },
                data: { isDeleted: true },
            });
            return res.status(StatusCodes.OK).json({
                message: 'User deleted successfully',
            });
        }
        catch (error) {
            console.error('Error deleting user:', error);
            return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                error: 'Failed to delete user',
            });
        }
    },
    async getAllUsers(req, res) {
        try {
            const page = parseInt(req.query.page, 10) || 1;
            const limit = parseInt(req.query.limit, 10) || 10;
            const search = req.query.search || '';
            const skip = (page - 1) * limit;
            const where = {
                isDeleted: false,
            };
            if (search) {
                where.OR = [
                    { name: { contains: search } },
                    { email: { contains: search } },
                    { walletAddress: { contains: search } },
                    { referralCode: { contains: search } },
                ];
            }
            const [users, total] = await Promise.all([
                prisma.user.findMany({
                    where,
                    skip,
                    take: limit,
                    select: {
                        wallet: {
                            select: {
                                // id: true,
                                walletAddress: true,
                                balance: true,
                                currency: true,
                            }
                        },
                        id: true,
                        name: true,
                        email: true,
                        walletAddress: true,
                        referralCode: true,
                        usdtBalance: true,
                        totalReferrals: true,
                        totalEarnings: true,
                        currentLevel: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                    orderBy: { createdAt: 'desc' },
                }),
                prisma.user.count({ where }),
            ]);
            const totalPages = Math.ceil(total / limit);
            return res.status(StatusCodes.OK).json({
                data: {
                    users,
                    pagination: {
                        total,
                        totalPages,
                        current: page,
                        count: users.length
                    },
                },
            });
        }
        catch (error) {
            console.error('Error fetching all users:', error);
            return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                error: 'Failed to fetch users: ' + error.message,
            });
        }
    },
    // Get user's referrals
    async getUserReferrals(req, res) {
        try {
            const id = req.params.id;
            const user = await prisma.user.findUnique({
                where: { id },
                include: {
                    referrals: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            referralCode: true,
                            createdAt: true,
                        },
                    },
                },
            });
            if (!user) {
                return res.status(StatusCodes.NOT_FOUND).json({
                    error: 'User not found',
                });
            }
            return res.status(StatusCodes.OK).json({
                data: {
                    totalReferrals: user.totalReferrals,
                    referrals: user.referrals,
                },
            });
        }
        catch (error) {
            console.error('Error fetching referrals:', error);
            return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                error: 'Failed to fetch referrals',
            });
        }
    },
    // Get user's wallet
    async getUserWallet(req, res) {
        try {
            const id = req.params.id;
            const wallet = await prisma.wallet.findUnique({
                where: { userId: id },
            });
            if (!wallet) {
                return res.status(StatusCodes.NOT_FOUND).json({
                    error: 'Wallet not found for this user',
                });
            }
            return res.status(StatusCodes.OK).json({
                data: wallet,
            });
        }
        catch (error) {
            console.error('Error fetching wallet:', error);
            return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                error: 'Failed to fetch wallet',
            });
        }
    },
};
//# sourceMappingURL=user.js.map