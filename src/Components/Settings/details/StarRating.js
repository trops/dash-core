import React, { useState, useEffect, useContext } from "react";
import { ThemeContext, FontAwesomeIcon } from "@trops/dash-react";

/**
 * StarRating — inline 5-star rating component for registry dashboards.
 *
 * Props:
 *   appId       – application identifier
 *   packageName – registry package name
 *   interactive – whether clicking sets a rating (default true)
 */
export const StarRating = ({ appId, packageName, interactive = true }) => {
  const { currentTheme } = useContext(ThemeContext);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!appId || !packageName) return;
    let cancelled = false;
    setLoading(true);
    window.mainApi?.dashboardRatings
      ?.getDashboardRating(appId, packageName)
      .then((result) => {
        if (!cancelled && result?.rating) {
          setRating(result.rating);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appId, packageName]);

  async function handleClick(value) {
    if (!interactive || !appId || !packageName) return;
    const newRating = value === rating ? 0 : value;
    setRating(newRating);
    try {
      await window.mainApi?.dashboardRatings?.saveDashboardRating(
        appId,
        packageName,
        newRating,
      );
    } catch (err) {
      console.error("[StarRating] Save error:", err);
    }
  }

  if (loading) return null;

  const displayRating = hoverRating || rating;

  return (
    <div
      className="flex items-center gap-0.5"
      onMouseLeave={() => setHoverRating(0)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={!interactive}
          onClick={() => handleClick(star)}
          onMouseEnter={() => interactive && setHoverRating(star)}
          className={`p-0.5 transition-colors ${
            interactive ? "cursor-pointer hover:scale-110" : "cursor-default"
          }`}
        >
          <FontAwesomeIcon
            icon={star <= displayRating ? "star" : ["far", "star"]}
            className={`h-3.5 w-3.5 ${
              star <= displayRating
                ? "text-yellow-400"
                : currentTheme["text-primary-medium"] || "text-gray-500"
            }`}
          />
        </button>
      ))}
    </div>
  );
};
