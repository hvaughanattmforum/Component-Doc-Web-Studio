variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
}

variable "app_name" {
  description = "Base name for all resources (ECR repo, ECS Express service, IAM roles)"
  type        = string
  default     = "oda-web-studio"
}

variable "github_owner" {
  description = "GitHub org/user that owns this app's repo (used for the OIDC deploy role's trust policy)"
  type        = string
  default     = "hvaughanattmforum"
}

variable "github_repo" {
  description = "GitHub repo name (used for the OIDC deploy role's trust policy)"
  type        = string
  default     = "Component-Doc-Web-Studio"
}

variable "spec_repo_url" {
  description = "Git URL of the ODA spec repo each signed-in user gets their own workspace clone of"
  type        = string
  default     = "https://github.com/tmforum-rand/TMForum-ODA-Component-Specification.git"
}

variable "spec_repo_branch" {
  description = "Base branch new session branches/PRs are created from"
  type        = string
  default     = "main"
}

variable "github_callback_url" {
  description = "GitHub OAuth callback URL. Leave blank for the first apply (the ECS Express service's own URL isn't known yet) - see README for the two-step bootstrap."
  type        = string
  default     = ""
}

variable "allowed_origin" {
  description = "CORS origin lock. Leave blank for the first apply, same bootstrap ordering as github_callback_url."
  type        = string
  default     = ""
}

variable "custom_domain" {
  description = "Not wired up yet for ECS Express Mode (custom domains there go through the ALB's listener + an ACM cert - see AWS's App Runner -> ECS Express Mode migration guide). Reserved for when that's added."
  type        = string
  default     = ""
}
