import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(145deg, #d9480f, #f76707)",
          color: "#fff",
          fontSize: 300,
          fontWeight: 700,
        }}
      >
        話
      </div>
    ),
    size,
  );
}
