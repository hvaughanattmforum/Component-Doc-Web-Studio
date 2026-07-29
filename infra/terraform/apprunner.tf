# Pins the service to exactly one instance - the app keeps sessions in
# memory and per-user workspace clones on local disk (see server/index.js),
# so it isn't safe to run more than one instance behind a shared endpoint.
resource "aws_apprunner_auto_scaling_configuration_version" "single_instance" {
  auto_scaling_configuration_name = "${var.app_name}-single-instance"
  min_size                        = 1
  max_size                        = 1
  max_concurrency                 = 100
}

locals {
  base_env_vars = {
    PORT             = "4310"
    NODE_ENV         = "production"
    SPEC_REPO_URL    = var.spec_repo_url
    SPEC_REPO_BRANCH = var.spec_repo_branch
  }

  # Both left unset until the service's own URL (or custom domain) is known -
  # see README "Bootstrapping".
  optional_env_vars = merge(
    var.github_callback_url != "" ? { GITHUB_CALLBACK_URL = var.github_callback_url } : {},
    var.allowed_origin != "" ? { ALLOWED_ORIGIN = var.allowed_origin } : {},
  )

  runtime_env_vars = merge(local.base_env_vars, local.optional_env_vars)
}

resource "aws_apprunner_service" "app" {
  service_name = var.app_name

  source_configuration {
    authentication_configuration {
      access_role_arn = aws_iam_role.apprunner_access.arn
    }
    # Redeploys automatically whenever :latest is pushed - see
    # .github/workflows/deploy.yml, which also calls start-deployment
    # explicitly so CI doesn't just fire-and-hope.
    auto_deployments_enabled = true

    image_repository {
      image_identifier      = "${aws_ecr_repository.app.repository_url}:latest"
      image_repository_type = "ECR"

      image_configuration {
        port                           = "4310"
        runtime_environment_variables  = local.runtime_env_vars
        runtime_environment_secrets = {
          SESSION_SECRET       = aws_secretsmanager_secret.session_secret.arn
          GITHUB_CLIENT_ID     = aws_secretsmanager_secret.github_client_id.arn
          GITHUB_CLIENT_SECRET = aws_secretsmanager_secret.github_client_secret.arn
        }
      }
    }
  }

  instance_configuration {
    cpu               = "1024" # 1 vCPU
    memory            = "2048" # 2 GB
    instance_role_arn = aws_iam_role.apprunner_instance.arn
  }

  auto_scaling_configuration_arn = aws_apprunner_auto_scaling_configuration_version.single_instance.arn

  health_check_configuration {
    protocol            = "HTTP"
    path                = "/api/health"
    interval            = 10
    timeout             = 5
    healthy_threshold   = 1
    unhealthy_threshold = 5
  }

  tags = {
    App = var.app_name
  }
}

resource "aws_apprunner_custom_domain_association" "app" {
  count       = var.custom_domain != "" ? 1 : 0
  domain_name = var.custom_domain
  service_arn = aws_apprunner_service.app.arn
}
