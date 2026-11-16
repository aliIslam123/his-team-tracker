import { z } from "zod";

export const JOB_TYPES = ["Doctor", "Specialist Doctor", "Head Nurse", "Nurse", "Administration"] as const;

export const staffSchema = z.object({
  full_name: z.string().trim().min(3),
  job_type: z.enum(JOB_TYPES),
  department_id: z.string().min(1).nullable().optional(),
  his_user_id: z.string().trim().max(40).nullable().optional(),
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(1),
  password: z.string().min(1),
});
