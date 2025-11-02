import { NextRequest, NextResponse } from "next/server";

interface GitHubCommitRequest {
  owner: string;
  repo: string;
}

interface GitHubCommitResponse {
  lastCommitDate?: string;
  starCount?: number;
  isArchived?: boolean;
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: GitHubCommitRequest = await request.json();
    const { owner, repo } = body;

    if (!owner || !repo) {
      return NextResponse.json(
        { error: "Missing owner or repo" },
        { status: 400 }
      );
    }

    const githubToken = process.env.GITHUB_API_TOKEN;
    const apiBase = "https://api.github.com";

    const repoUrl = `${apiBase}/repos/${owner}/${repo}`;
    const repoResponse = await fetch(repoUrl, {
      headers: {
        ...(githubToken && { Authorization: `Bearer ${githubToken}` }),
        "User-Agent": "putesco",
      },
    });

    if (!repoResponse.ok) {
      return NextResponse.json(
        { error: `Failed to fetch repo info: ${repoResponse.status}` },
        { status: repoResponse.status }
      );
    }

    const repoData = await repoResponse.json();
    const defaultBranch = repoData.default_branch || "main";
    const starCount = repoData.stargazers_count;
    const isArchived = repoData.archived || false;

    const commitsUrl = `${apiBase}/repos/${owner}/${repo}/commits/${defaultBranch}`;
    const commitResponse = await fetch(commitsUrl, {
      headers: {
        ...(githubToken && { Authorization: `Bearer ${githubToken}` }),
        "User-Agent": "putesco",
      },
    });

    if (!commitResponse.ok) {
      return NextResponse.json(
        { error: `Failed to fetch commits: ${commitResponse.status}` },
        { status: commitResponse.status }
      );
    }

    const commitData = await commitResponse.json();
    const latestCommit = Array.isArray(commitData) ? commitData[0] : commitData;

    let lastCommitDate: string | undefined;
    if (latestCommit) {
      lastCommitDate = latestCommit.commit?.committer?.date;
    }

    return NextResponse.json({
      lastCommitDate,
      starCount,
      isArchived,
    } as GitHubCommitResponse);
  } catch (error) {
    console.error("GitHub API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
