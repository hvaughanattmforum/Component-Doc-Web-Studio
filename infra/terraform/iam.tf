# Execution / infrastructure / task IAM roles for the ECS Express service
# are created by the module itself - see ecs-express.tf.

# --- GitHub Actions deploy role: OIDC federation, no long-lived AWS keys ---
# --- in the repo's CI secrets ---

data "tls_certificate" "github_actions" {
  url = "https://token.actions.githubusercontent.com/.well-known/openid-configuration"
}

resource "aws_iam_openid_connect_provider" "github_actions" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github_actions.certificates[0].sha1_fingerprint]
}

data "aws_iam_policy_document" "github_actions_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    # Restricts to this exact repo, any branch/tag/PR - tighten to
    # "repo:${var.github_owner}@${var.github_owner_id}/${var.github_repo}@${var.github_repo_id}:ref:refs/heads/main"
    # if only main should ever be able to deploy.
    #
    # Uses the immutable owner@id/repo@id shape, not the plain
    # owner/repo one - see github_owner_id/github_repo_id in variables.tf.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_owner}@${var.github_owner_id}/${var.github_repo}@${var.github_repo_id}:*"]
    }
  }
}

resource "aws_iam_role" "github_actions_deploy" {
  name               = "${var.app_name}-github-actions-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_actions_assume.json
}

data "aws_iam_policy_document" "github_actions_permissions" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:PutImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
    ]
    resources = [aws_ecr_repository.app.arn]
  }
  statement {
    sid       = "EcsDeploy"
    actions   = ["ecs:UpdateService", "ecs:DescribeServices", "ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"]
    resources = ["*"] # Express Mode manages the underlying task definition itself; no single resource ARN to scope to before first apply.
  }
  statement {
    sid       = "PassExpressServiceRoles"
    actions   = ["iam:PassRole"]
    resources = [module.express_service.execution_iam_role_arn, module.express_service.task_iam_role_arn]
  }

  # Lets CI re-point the custom domain's listener rule at whichever target
  # group Express Mode just made active - see custom_domain_listener_rule_arn
  # in variables.tf for why this exists.
  dynamic "statement" {
    for_each = var.custom_domain_listener_rule_arn != "" ? [1] : []
    content {
      sid       = "DescribeAlbForCustomDomainRepoint"
      actions   = ["elasticloadbalancing:DescribeRules", "elasticloadbalancing:DescribeTargetHealth"]
      resources = ["*"] # Describe* actions require resource "*" in ELB's IAM model.
    }
  }
  dynamic "statement" {
    for_each = var.custom_domain_listener_rule_arn != "" ? [1] : []
    content {
      sid       = "ModifyCustomDomainRule"
      actions   = ["elasticloadbalancing:ModifyRule"]
      resources = [var.custom_domain_listener_rule_arn]
    }
  }
}

resource "aws_iam_role_policy" "github_actions_permissions" {
  name   = "${var.app_name}-deploy-permissions"
  role   = aws_iam_role.github_actions_deploy.id
  policy = data.aws_iam_policy_document.github_actions_permissions.json
}
