# Multi-stage build: frontend -> API wwwroot, then a slim ASP.NET runtime image.
FROM node:22-alpine AS web
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN OUT_DIR=/out/wwwroot npx vite build && npx tsc -b --noEmit

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS api
WORKDIR /src
COPY backend/ ./
RUN dotnet publish src/SignageCms.Api/SignageCms.Api.csproj -c Release -o /out/app

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=api /out/app ./
COPY --from=web /out/wwwroot ./wwwroot
ENV ASPNETCORE_URLS=http://+:8080 Storage__RootPath=/data/media
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["dotnet", "SignageCms.Api.dll"]
