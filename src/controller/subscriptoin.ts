import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import type { SubscriptionPlan } from '../../generated/prisma/index.js';
import prisma from '../config/prisma.js';

export const subscriptionPlanController = {
  // Create a new subscription plan
  async createSubscriptionPlan(req: Request, res: Response) {
    try {
      const { name, minimumInvestment, maximumInvestment, roiPerMonth, roiPerDay, maximumEarning, durationInMonths, description, isActive } = req.body;

      // Validate required fields
      if (!name || minimumInvestment === undefined || maximumInvestment === undefined || durationInMonths === undefined) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          error: 'name, minimumInvestment, maxInvestment and durationInMonths are required',
        });
      }

      // Validate that only one of roiPerMonth or roiPerDay is provided
      if (roiPerMonth !== undefined && roiPerDay !== undefined) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          error: 'Only one of roiPerMonth or roiPerDay should be provided, not both',
        });
      }

      // Validate at least one of roiPerMonth or roiPerDay is provided
      if (roiPerMonth === undefined && roiPerDay === undefined) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          error: 'At least one of roiPerMonth or roiPerDay must be provided',
        });
      }
      if (maximumInvestment <= minimumInvestment) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          error: 'maximumInvestment must be greater than minimumInvestment',
        });
      }
     

      // Validate numeric fields
      if (minimumInvestment < 0) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          error: 'minimumInvestment must be non-negative',
        });
      }
      if (roiPerMonth !== undefined && roiPerMonth < 0) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          error: 'roiPerMonth must be non-negative',
        });
      }
      if (roiPerDay !== undefined && roiPerDay < 0) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          error: 'roiPerDay must be non-negative',
        });
      }
      if (durationInMonths <= 0) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          error: 'durationInMonths must be positive',
        });
      }

      // Create subscription plan
      const subscriptionPlan = await prisma.subscriptionPlan.create({
        data: {
          name,
          minimumInvestment,
          maximumInvestment,
          roiPerMonth,
          roiPerDay,
          maximumEarning,
          durationInMonths,
          description,
          isActive: isActive !== undefined ? isActive : true,
        },
        select: {
          id: true,
          name: true,
          minimumInvestment: true,
          maximumInvestment: true,
          roiPerMonth: true,
          roiPerDay: true,
          maximumEarning: true,
          durationInMonths: true,
          description: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.status(StatusCodes.CREATED).json({
        message: 'Subscription plan created successfully',
        data: subscriptionPlan,
      });
    } catch (error) {
      console.error('Error creating subscription plan:', error);
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to create subscription plan',
      });
    }
  },

  // Get a subscription plan by ID
  async getSubscriptionPlanById(req: Request, res: Response) {
    try {
      const id  = req.params.id as string;
      const userId = req.query?.id as string; // May be undefined if not logged in

      const subscriptionPlan = await prisma.subscriptionPlan.findUnique({
        where: { id },
        include: {
          investments: {
            select: {
              id: true,
              userId: true,
              amountInvested: true,
              status: true,
              startDate: true,
              endDate: true,
            },
          },
        },
      });

      if (!subscriptionPlan) {
        return res.status(StatusCodes.NOT_FOUND).json({
          error: 'Subscription plan not found',
        });
      }

      // Check if user has purchased this plan only if logged in
      let isSubscribed = false;
      if (userId) {
        const userInvestment = await prisma.investment.findFirst({
          where: {
            userId,
            planId: id,
            status: { in: ['ACTIVE', 'COMPLETED'] }, // Assuming purchased means active or completed
          },
        });
        isSubscribed = !!userInvestment;
      }

      return res.status(StatusCodes.OK).json({
        data: {
          ...subscriptionPlan,
          isSubscribed,
        },
      });
    } catch (error) {
      console.error('Error fetching subscription plan:', error);
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to fetch subscription plan',
      });
    }
  },

  // Get all subscription plans
  async getAllSubscriptionPlans(req: Request, res: Response) {
    try {
      const userId = req.query?.id as string; // May be undefined if not logged in

      const subscriptionPlans = await prisma.subscriptionPlan.findMany({
        where: {
          isDeleted: false,
        },
        select: {
          id: true,
          name: true,
          minimumInvestment: true,
          maximumInvestment: true,
          roiPerMonth: true,
          roiPerDay: true,
          maximumEarning: true,
          durationInMonths: true,
          description: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // Fetch global settings for maxiumEarningReturn
      const settings = await prisma.setting.findFirst();
      const maxEarningMultiplier = settings?.maxiumEarningReturn || 0;

      // Check user's investments to see which plans they have purchased only if logged in
      let hasAnySubscriptions = false;
      const userInvestmentsMap = new Map<string, number>();

      if (userId) {
        const userInvestments = await prisma.investment.findMany({
          where: {
            userId,
            status: { in: ['ACTIVE', 'COMPLETED'] }, // Assuming purchased means active or completed
          },
          select: { planId: true, amountInvested: true },
        });

        userInvestments.forEach(inv => {
          const amount = Number(inv.amountInvested);
          const currentTotal = userInvestmentsMap.get(inv.planId) || 0;
          userInvestmentsMap.set(inv.planId, currentTotal + amount);
        });

        hasAnySubscriptions = userInvestments.length > 0;
      }

      const plansWithUserInfo = subscriptionPlans.map(plan => {
        const investedAmount = userInvestmentsMap.get(plan.id);
        const isSubscribed = investedAmount !== undefined;

        // Calculate dynamic maximum earning if subscribed
        // Otherwise, return null to hide it (removing the static plan value)
        let dynamicMaximumEarning = null;
        if (isSubscribed) {
          dynamicMaximumEarning = (investedAmount || 0) * maxEarningMultiplier;
        }

        return {
          ...plan,
          isSubscribed,
          maximumEarning: dynamicMaximumEarning,
        };
      });

      return res.status(StatusCodes.OK).json({
        data: plansWithUserInfo,
        hasAnySubscriptions,
      });
    } catch (error) {
      console.error('Error fetching subscription plans:', error);
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to fetch subscription plans',
      });
    }
  },

  // Update a subscription plan
  async updateSubscriptionPlan(req: Request, res: Response) {
    try {
      const id  = req.params.id as string;
      const { name, minimumInvestment, maximumInvestment, roiPerMonth, roiPerDay, maximumEarning, durationInMonths, description, isActive } = req.body;

      // Check if subscription plan exists
      const subscriptionPlan = await prisma.subscriptionPlan.findUnique({ where: { id } });
      if (!subscriptionPlan) {
        return res.status(StatusCodes.NOT_FOUND).json({
          error: 'Subscription plan not found',
        });
      }

      // Validate that only one of roiPerMonth or roiPerDay is provided if both are being updated
      if (roiPerMonth !== undefined && roiPerDay !== undefined) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          error: 'Only one of roiPerMonth or roiPerDay should be provided, not both',
        });
      }

      // Check for active investments if setting isActive to false
      if (isActive === false) {
        const activeInvestments = await prisma.investment.count({
          where: { planId: id, status: 'ACTIVE' },
        });
        if (activeInvestments > 0) {
          return res.status(StatusCodes.BAD_REQUEST).json({
            error: 'Cannot deactivate plan with active investments',
          });
        }
      }

      // Prepare update data
      const updateData: Partial<SubscriptionPlan> = {};
      if (name) updateData.name = name;
      if (minimumInvestment !== undefined) updateData.minimumInvestment = minimumInvestment;
      if (maximumInvestment !== undefined) updateData.maximumInvestment = maximumInvestment;
      if (roiPerMonth !== undefined) updateData.roiPerMonth = roiPerMonth;
      if (roiPerDay !== undefined) updateData.roiPerDay = roiPerDay;
      if (durationInMonths !== undefined) updateData.durationInMonths = durationInMonths;
      if (maximumEarning !== undefined) updateData.maximumEarning = maximumEarning;
      if (description !== undefined) updateData.description = description;
      if (isActive !== undefined) updateData.isActive = isActive;

      // Validate numeric fields
      if (minimumInvestment !== undefined && minimumInvestment < 0) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          error: 'minimumInvestment must be non-negative',
        });
      }
      if (maximumInvestment !== undefined && maximumInvestment < 0) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          error: 'maximumInvestment must be non-negative',
        });
      }
      if (roiPerMonth !== undefined && roiPerMonth < 0) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          error: 'roiPerMonth must be non-negative',
        });
      }
      if (roiPerDay !== undefined && roiPerDay < 0) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          error: 'roiPerDay must be non-negative',
        });
      }
      if (durationInMonths !== undefined && durationInMonths <= 0) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          error: 'durationInMonths must be positive',
        });
      }

      // Update subscription plan
      const updatedSubscriptionPlan = await prisma.subscriptionPlan.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          name: true,
          minimumInvestment: true,
          maximumInvestment: true,
          roiPerMonth: true,
          roiPerDay: true,
          maximumEarning: true,
          durationInMonths: true,
          description: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.status(StatusCodes.OK).json({
        message: 'Subscription plan updated successfully',
        data: updatedSubscriptionPlan,
      });
    } catch (error) {
      console.error('Error updating subscription plan:', error);
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to update subscription plan',
      });
    }
  },

  // Delete a subscription plan
  async deleteSubscriptionPlan(req: Request, res: Response) {
    try {
      const id  = req.params.id as string;

      // Check if subscription plan exists
      const subscriptionPlan = await prisma.subscriptionPlan.findUnique({ where: { id } });
      if (!subscriptionPlan) {
        return res.status(StatusCodes.NOT_FOUND).json({
          error: 'Subscription plan not found',
        });
      }

      await prisma.subscriptionPlan.update({
        where: { id },
        data: { isDeleted: true },
      });

      return res.status(StatusCodes.OK).json({
        message: 'Subscription plan deleted successfully',
      });
    } catch (error) {
      console.error('Error deleting subscription plan:', error);
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to delete subscription plan',
      });
    }
  },

  // Get investments for a subscription plan
  async getSubscriptionPlanInvestments(req: Request, res: Response) {
    try {
      const id  = req.params.id as string;

      const subscriptionPlan = await prisma.subscriptionPlan.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          minimumInvestment: true,
          maximumInvestment: true,
          roiPerMonth: true,
          roiPerDay: true,
          maximumEarning: true,
          durationInMonths: true,
          investments: {
            select: {
              id: true,
              userId: true,
              amountInvested: true,
              status: true,
              startDate: true,
              endDate: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      });

      if (!subscriptionPlan) {
        return res.status(StatusCodes.NOT_FOUND).json({
          error: 'Subscription plan not found',
        });
      }

      return res.status(StatusCodes.OK).json({
        data: subscriptionPlan,
      });
    } catch (error) {
      console.error('Error fetching investments for subscription plan:', error);
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to fetch investments',
      });
    }
  },
};