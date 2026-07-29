# Amazon ECS Express Mode - replaces the AWS App Runner scaffold (see git
# history: apprunner.tf). AWS closed App Runner to new customers on
# 2026-04-30 - this account had never created an App Runner service before,
# so every deployment attempt silently failed with no application logs and
# no CloudTrail errors (a platform-level block, not a config problem).
# https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html
#
# ECS Express Mode is AWS's own recommended replacement: one resource
# provisions the Fargate service, ALB, auto scaling and networking.
# https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-overview.html

locals {
  base_env_vars = {
    PORT             = "4310"
    NODE_ENV         = "production"
    SPEC_REPO_URL    = var.spec_repo_url
    SPEC_REPO_BRANCH = var.spec_repo_branch
  }

  # Both left unset until the service's own URL is known - see README
  # "Bootstrapping".
  optional_env_vars = merge(
    var.github_callback_url != "" ? { GITHUB_CALLBACK_URL = var.github_callback_url } : {},
    var.allowed_origin != "" ? { ALLOWED_ORIGIN = var.allowed_origin } : {},
  )

  runtime_env_vars = merge(local.base_env_vars, local.optional_env_vars)
}

module "express_service" {
  source  = "terraform-aws-modules/ecs/aws//modules/express-service"
  version = "7.5.0"

  name = var.app_name

  cpu    = 1024 # 1 vCPU
  memory = 2048 # 2 GB

  primary_container = {
    image          = "${aws_ecr_repository.app.repository_url}:latest"
    container_port = 4310

    environment = [
      for k, v in local.runtime_env_vars : { name = k, value = v }
    ]

    # Values are never set here - see secrets.tf / README "Bootstrapping".
    secret = [
      { name = "SESSION_SECRET", value_from = aws_secretsmanager_secret.session_secret.arn },
      { name = "GITHUB_CLIENT_ID", value_from = aws_secretsmanager_secret.github_client_id.arn },
      { name = "GITHUB_CLIENT_SECRET", value_from = aws_secretsmanager_secret.github_client_secret.arn },
    ]
  }

  health_check_path = "/api/health"

  # Single task - same reasoning as the old App Runner min=max=1 config: the
  # app keeps sessions in memory and per-user workspace clones on local
  # disk, so it isn't safe to run more than one instance behind a shared
  # endpoint.
  scaling_target = {
    min_task_count            = 1
    max_task_count            = 1
    auto_scaling_metric       = "AVERAGE_CPU"
    auto_scaling_target_value = 70
  }

  # Not passing network_configuration - letting Express Mode manage its own
  # networking entirely, so no need for us to create a security group that
  # would otherwise go unattached.
  create_security_group = false

  execution_iam_role_name      = "${var.app_name}-exec"
  infrastructure_iam_role_name = "${var.app_name}-infra"
  task_iam_role_name           = "${var.app_name}-task"

  # Grants the execution role read access to the 3 secrets above - this is
  # what actually lets ECS resolve `secret` at task-start time.
  execution_secret_arns = [
    aws_secretsmanager_secret.session_secret.arn,
    aws_secretsmanager_secret.github_client_id.arn,
    aws_secretsmanager_secret.github_client_secret.arn,
  ]

  tags = {
    App = var.app_name
  }
}
